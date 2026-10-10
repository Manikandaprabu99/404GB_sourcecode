import { mapWithConcurrency } from "@/lib/concurrency";
import {
  branchReader,
  commitReader,
  CorruptJsonError,
  fetchRawContent,
  getOctokit,
  githubRetryAfterSeconds,
  objectPathForHash,
  runTransaction,
  serializeJsonArray,
  TreeWriteError,
  type BlobInput,
  type RepoReader,
  type RepoRef,
} from "@/lib/github";
import { ALBUMS_PATH, normalizeAlbums, removeMediaFromAlbums } from "@/lib/albums/server";
import { ApiError } from "@/lib/session/api";
// Constant only — the rest of that client-oriented module never runs here.
import { THUMBNAIL_SIZES } from "@/lib/thumbnails";
// Type-only: sharp loads via runtime import() so a broken native binary is a catchable failure.
import type SharpModule from "sharp";
import {
  isMediaId,
  makeMediaId,
  MEDIA_INDEX_PATH,
  metadataPath,
  thumbnailPath,
  toIndexEntry,
  type MediaIndexEntry,
  type MediaRecord,
} from "./types";
import { normalizeUploadRecord, pickBlobShas, pickThumbnailShas, withMediaId } from "./validate";

export * from "./types";

/** Parallel chunk fetches when reassembling a file server-side. */
const CHUNK_FETCH_CONCURRENCY = 4;
// sharp's prebuilt libvips decodes AVIF but not HEVC-coded HEIC/HEIF.
const SHARP_UNSUPPORTED = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const BACKFILL_MAX_BYTES = 48 * 1024 * 1024;

function readIndex(reader: RepoReader): Promise<MediaIndexEntry[]> {
  return reader.readJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH);
}

/** manifest/media-index.json at `commitSha`, or at the branch head when omitted. */
export async function readMediaIndex(repo: RepoRef, commitSha?: string): Promise<MediaIndexEntry[]> {
  return readIndex(commitSha ? commitReader(repo, commitSha) : branchReader(repo));
}

/** One metadata/<id>.json record. */
export async function readMediaRecord(repo: RepoRef, id: string): Promise<MediaRecord | null> {
  if (!isMediaId(id)) return null;
  const octokit = getOctokit(repo.accessToken);
  const buf = await fetchRawContent(octokit, repo.owner, repo.repo, metadataPath(id), repo.branch);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf-8")) as MediaRecord;
  } catch {
    return null;
  }
}

/** Fetches a record's chunks (bounded concurrency) and concatenates them in order. */
export async function reconstructMedia(repo: RepoRef, record: MediaRecord): Promise<Buffer> {
  const octokit = getOctokit(repo.accessToken);
  const ordered = [...record.chunks].sort((a, b) => a.index - b.index);
  const parts = await mapWithConcurrency(ordered, CHUNK_FETCH_CONCURRENCY, async (chunk) => {
    const path = objectPathForHash(chunk.hash);
    const bytes = await fetchRawContent(octokit, repo.owner, repo.repo, path, repo.branch);
    if (!bytes) throw new Error(`Missing chunk object at ${path}`);
    return bytes;
  });
  return Buffer.concat(parts);
}

export interface UploadCheck {
  /** Chunk hashes with no objects/ file yet — the ones the client must upload. */
  missing: string[];
  /** Id of an indexed item with the same whole-file hash; nothing needs uploading then. */
  duplicateOf: string | null;
  /** The duplicate has no capture date: send this file's via POST /api/media/<id>/taken-at. */
  duplicateNeedsDate?: boolean;
}

/** POST /api/media/upload/init: duplicate check plus which chunks are missing. */
export async function checkUpload(
  repo: RepoRef,
  chunkHashes: readonly string[],
  fileHash?: string
): Promise<UploadCheck> {
  const reader = branchReader(repo);
  if (fileHash) {
    const hash = `sha256:${fileHash}`;
    const existing = (await readIndex(reader)).find((entry) => entry.hash === hash);
    if (existing) return { missing: [], duplicateOf: existing.id, duplicateNeedsDate: !existing.takenAt };
  }
  const unique = Array.from(new Set(chunkHashes));
  const stored = await reader.existingObjects(unique);
  return { missing: unique.filter((hash) => !stored.has(hash)), duplicateOf: null };
}

export interface CommitUploadInput {
  record: unknown;
  /** Blob shas of chunks uploaded via /api/media/upload/chunk, keyed by chunk hash. */
  chunkBlobShas?: unknown;
  /** Blob shas of thumbnail webps uploaded the same way, keyed by "320" | "800" | "1600". */
  thumbnailBlobShas?: unknown;
}

export interface CommitUploadResult {
  id: string;
  /** The same file (by whole-file hash) was already indexed; nothing was added. */
  duplicate: boolean;
  commitSha: string | null;
  entry: MediaIndexEntry;
  /** The stored record; null for duplicates. */
  record: MediaRecord | null;
}

type CommitOutcome = Omit<CommitUploadResult, "commitSha">;

/** One commit for chunks, thumbnails, metadata and index entry; idempotent by hash even under concurrent uploads. */
export async function commitMediaUpload(
  repo: RepoRef,
  input: CommitUploadInput
): Promise<CommitUploadResult> {
  const thumbnailBlobShas = pickThumbnailShas(input.thumbnailBlobShas);
  let record = normalizeUploadRecord(input.record, thumbnailBlobShas);
  const chunkHashes = new Set(record.chunks.map((chunk) => chunk.hash));
  const chunkBlobShas = pickBlobShas(input.chunkBlobShas, (key) => chunkHashes.has(key));

  // A record must never reference chunks that aren't stored.
  const unsupplied = Array.from(chunkHashes).filter((hash) => !chunkBlobShas[hash]);
  if (unsupplied.length > 0) {
    const stored = await branchReader(repo).existingObjects(unsupplied);
    const missing = unsupplied.filter((hash) => !stored.has(hash));
    if (missing.length > 0) {
      throw new ApiError(409, "Some parts of this file haven't been uploaded yet", "missing_chunks", { missing });
    }
  }

  try {
    const { result, commitSha } = await runTransaction<CommitOutcome>(repo, async (snapshot) => {
      const index = await readIndex(snapshot);
      const existing = index.find((entry) => entry.hash === record.hash);
      if (existing) {
        return { result: { id: existing.id, duplicate: true, entry: existing, record: null } };
      }
      if (index.some((entry) => entry.id === record.id)) record = withMediaId(record, makeMediaId());

      const entry = toIndexEntry(record);
      const blobs: BlobInput[] = [
        ...Object.entries(chunkBlobShas).map(([hash, sha]) => ({ path: objectPathForHash(hash), sha })),
        ...Object.entries(thumbnailBlobShas).map(([size, sha]) => ({ path: thumbnailPath(record.id, size), sha })),
        { path: metadataPath(record.id), text: JSON.stringify(record, null, 2) },
        { path: MEDIA_INDEX_PATH, text: serializeJsonArray([...index, entry]) },
      ];
      return {
        result: { id: record.id, duplicate: false, entry, record },
        commit: { blobs, message: `404gb: upload ${record.filename}` },
      };
    });
    return { ...result, commitSha };
  } catch (err) {
    if (err instanceof TreeWriteError) {
      throw new ApiError(
        422,
        "Some uploaded parts are no longer on GitHub — upload them again",
        "unknown_blob"
      );
    }
    throw err;
  }
}

export interface SetTakenAtResult {
  /** False when the item is gone or already had a capture date (which is never overwritten). */
  changed: boolean;
  entry: MediaIndexEntry | null;
}

/**
 * Gives an item uploaded without a capture date (older web uploads) the date
 * a later upload of the same file knew, so it sorts under the day it was taken.
 */
export async function setTakenAtIfMissing(repo: RepoRef, id: string, takenAt: string): Promise<SetTakenAtResult> {
  if (!isMediaId(id)) return { changed: false, entry: null };
  const { result } = await runTransaction<SetTakenAtResult>(repo, async (snapshot) => {
    const index = await readIndex(snapshot);
    const entry = index.find((item) => item.id === id);
    if (!entry || entry.takenAt) return { result: { changed: false, entry: entry ?? null } };
    const updated: MediaIndexEntry = { ...entry, takenAt };
    const blobs: BlobInput[] = [
      { path: MEDIA_INDEX_PATH, text: serializeJsonArray(index.map((item) => (item.id === id ? updated : item))) },
    ];
    const record = await snapshot.readJson<MediaRecord>(metadataPath(id));
    if (record && !record.takenAt) {
      blobs.push({ path: metadataPath(id), text: JSON.stringify({ ...record, takenAt }, null, 2) });
    }
    return {
      result: { changed: true, entry: updated },
      commit: { blobs, message: `404gb: set capture date of ${entry.filename}` },
    };
  });
  return result;
}

export type ThumbnailBackfillStatus = "created" | "skipped" | "failed";

export interface ThumbnailBackfillResult {
  status: ThumbnailBackfillStatus;
  /** size -> repo-relative path (same shape as MediaRecord.thumbnails), when thumbnails exist. */
  thumbnails?: Record<string, string>;
}

function hasThumbnails(record: MediaRecord): boolean {
  return !!record.thumbnails && Object.keys(record.thumbnails).length > 0;
}

/** Best-effort sharp thumbnails for images the browser couldn't decode; only rate limits throw. */
export async function backfillThumbnailIfMissing(
  repo: RepoRef,
  mediaId: string,
  /** The record when the caller already has it (it's re-checked before committing). */
  knownRecord?: MediaRecord
): Promise<ThumbnailBackfillResult> {
  const record = knownRecord ?? (await readMediaRecord(repo, mediaId));
  if (!record || record.deletedAt) return { status: "skipped" };
  if (hasThumbnails(record)) return { status: "skipped", thumbnails: record.thumbnails };
  const mimeType = record.mimeType?.toLowerCase() ?? "";
  if (!mimeType.startsWith("image/") || SHARP_UNSUPPORTED.has(mimeType) || record.size > BACKFILL_MAX_BYTES) {
    return { status: "skipped" };
  }

  let sharpFactory: typeof SharpModule;
  try {
    const mod = await import("sharp");
    sharpFactory = (mod as unknown as { default: typeof SharpModule }).default;
  } catch {
    return { status: "failed" };
  }

  let original: Buffer;
  try {
    original = await reconstructMedia(repo, record);
  } catch (err) {
    if (githubRetryAfterSeconds(err) !== null) throw err;
    return { status: "failed" };
  }

  const generated: Array<{ size: string; buffer: Buffer }> = [];
  try {
    // rotate() bakes in EXIF orientation so the thumbnail isn't sideways.
    const source = sharpFactory(original, { failOn: "none" }).rotate();
    for (const size of THUMBNAIL_SIZES) {
      const buffer = await source
        .clone()
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      generated.push({ size: String(size), buffer });
    }
  } catch {
    return { status: "failed" };
  }

  const octokit = getOctokit(repo.accessToken);
  const thumbShas: Record<string, string> = {};
  for (const { size, buffer } of generated) {
    const { data } = await octokit.git.createBlob({
      owner: repo.owner,
      repo: repo.repo,
      content: buffer.toString("base64"),
      encoding: "base64",
    });
    thumbShas[size] = data.sha;
  }

  const { result } = await runTransaction<ThumbnailBackfillResult>(repo, async (snapshot) => {
    const current = await snapshot.readJson<MediaRecord>(metadataPath(mediaId));
    if (!current || current.deletedAt) return { result: { status: "skipped" } };
    if (hasThumbnails(current)) return { result: { status: "skipped", thumbnails: current.thumbnails } };
    const index = await readIndex(snapshot);
    if (!index.some((entry) => entry.id === mediaId)) return { result: { status: "skipped" } };

    const thumbnails: Record<string, string> = {};
    for (const size of Object.keys(thumbShas)) thumbnails[size] = thumbnailPath(mediaId, size);
    const updatedIndex = index.map((entry) =>
      entry.id === mediaId ? { ...entry, thumb: thumbnails["320"] } : entry
    );
    return {
      result: { status: "created", thumbnails },
      commit: {
        blobs: [
          ...Object.entries(thumbShas).map(([size, sha]) => ({ path: thumbnailPath(mediaId, size), sha })),
          { path: metadataPath(mediaId), text: JSON.stringify({ ...current, thumbnails }, null, 2) },
          { path: MEDIA_INDEX_PATH, text: serializeJsonArray(updatedIndex) },
        ],
        message: `404gb: backfill thumbnail for ${current.filename}`,
      },
    };
  });
  return result;
}

export interface DeleteMediaResult {
  /** Ids that were present and removed; unknown or already-deleted ids are dropped. */
  deletedIds: string[];
  /** Null when nothing changed (no commit made). */
  commitSha: string | null;
}

/** One commit removing index entries, metadata files and album membership; objects/ stay (chunks may be shared). */
export async function deleteMedia(repo: RepoRef, ids: readonly string[]): Promise<DeleteMediaResult> {
  const requested = new Set(ids.filter(isMediaId));
  if (requested.size === 0) return { deletedIds: [], commitSha: null };

  const { result, commitSha } = await runTransaction<string[]>(repo, async (snapshot) => {
    const index = await readIndex(snapshot);
    const deletedIds = index.filter((entry) => requested.has(entry.id)).map((entry) => entry.id);
    if (deletedIds.length === 0) return { result: [] };
    const deleted = new Set(deletedIds);

    const metadataShas = await snapshot.fileShas(deletedIds.map(metadataPath));
    const blobs: BlobInput[] = Array.from(metadataShas)
      .filter(([, sha]) => sha !== null)
      .map(([path]) => ({ path, delete: true as const }));
    blobs.push({ path: MEDIA_INDEX_PATH, text: serializeJsonArray(index.filter((entry) => !deleted.has(entry.id))) });

    try {
      const albums = normalizeAlbums(await snapshot.readJsonArray<unknown>(ALBUMS_PATH));
      const pruned = removeMediaFromAlbums(albums, deleted, new Date().toISOString());
      if (pruned.changed) blobs.push({ path: ALBUMS_PATH, text: serializeJsonArray(pruned.albums) });
    } catch (err) {
      // A damaged albums.json must not block deleting photos; album writes report it.
      if (!(err instanceof CorruptJsonError)) throw err;
    }

    return {
      result: deletedIds,
      commit: {
        blobs,
        message:
          deletedIds.length === 1 ? `404gb: delete ${deletedIds[0]}` : `404gb: delete ${deletedIds.length} items`,
      },
    };
  });

  return commitSha ? { deletedIds: result, commitSha } : { deletedIds: [], commitSha: null };
}

function withFavorite<T extends { favorite?: boolean }>(item: T, favorite: boolean): T {
  const copy = { ...item };
  if (favorite) copy.favorite = true;
  else delete copy.favorite;
  return copy;
}

export interface SetFavoriteResult {
  /** Index entries of the requested ids that exist, after the change. */
  entries: MediaIndexEntry[];
  commitSha: string | null;
}

/** Sets or clears `favorite` on index entries and metadata records, in one commit. */
export async function setFavorite(
  repo: RepoRef,
  ids: readonly string[],
  favorite: boolean
): Promise<SetFavoriteResult> {
  const requested = new Set(ids.filter(isMediaId));
  if (requested.size === 0) return { entries: [], commitSha: null };

  const { result, commitSha } = await runTransaction<MediaIndexEntry[]>(repo, async (snapshot) => {
    const index = await readIndex(snapshot);
    const changing = new Set(
      index.filter((entry) => requested.has(entry.id) && !!entry.favorite !== favorite).map((entry) => entry.id)
    );
    const updatedIndex = index.map((entry) => (changing.has(entry.id) ? withFavorite(entry, favorite) : entry));
    const entries = updatedIndex.filter((entry) => requested.has(entry.id));
    if (changing.size === 0) return { result: entries };

    const blobs: BlobInput[] = [];
    const records = await snapshot.readTexts(Array.from(changing, metadataPath));
    for (const [path, text] of records) {
      if (text === null) continue;
      let record: MediaRecord;
      try {
        record = JSON.parse(text) as MediaRecord;
      } catch {
        continue;
      }
      blobs.push({ path, text: JSON.stringify(withFavorite(record, favorite), null, 2) });
    }
    blobs.push({ path: MEDIA_INDEX_PATH, text: serializeJsonArray(updatedIndex) });

    const verb = favorite ? "favorite" : "unfavorite";
    return {
      result: entries,
      commit: {
        blobs,
        message: changing.size === 1 ? `404gb: ${verb} ${[...changing][0]}` : `404gb: ${verb} ${changing.size} items`,
      },
    };
  });
  return { entries: result, commitSha };
}
