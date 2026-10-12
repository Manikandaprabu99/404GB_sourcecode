// Library operations on the storage repo, run in the browser: the index sync, records,
// uploads (dedup check, blobs, one commit), favorites, capture dates, thumbnail backfill,
// Trash (move, restore, purge) and deletes. Writes go through lib/github's race-safe transaction.

import { ALBUMS_PATH, normalizeAlbums, removeMediaFromAlbums } from "@/lib/albums";
import { DEFAULT_CHUNK_SIZE } from "@/lib/chunking";
import {
  branchReader,
  bytesToBase64,
  CorruptJsonError,
  createBlob,
  encodePath,
  getContentBinary,
  getHead,
  githubErrorFrom,
  githubFetch,
  githubRetryAfterSeconds,
  isAbortError,
  isGitHubAuthError,
  objectPathForHash,
  parseJsonArray,
  repoPath,
  RepoError,
  runTransaction,
  serializeJsonArray,
  sha256HexOf,
  TreeWriteError,
  utf8Text,
  type BlobInput,
  type Bytes,
  type RepoReader,
  type RepoRef,
} from "@/lib/github";
import { generateThumbnails } from "@/lib/thumbnails";
import { reconstructMediaClient } from "./reconstructClient";
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
import {
  isChunkHash,
  normalizeDate,
  normalizeUploadRecord,
  pickBlobShas,
  pickThumbnailShas,
  withMediaId,
} from "./validate";

export * from "./types";

/** Commit bookkeeping returned by writes, so the library can skip re-reading its own commits. */
export interface CommitInfo {
  /** Null when nothing changed (no commit made). */
  commitSha: string | null;
  /** The commit the change was built on. */
  parentSha: string;
}

// Images the browser can decode into thumbnails (HEIC/HEIF and RAW formats can't be).
const BACKFILL_DECODABLE = /^image\/(jpeg|jpg|pjpeg|png|apng|webp|gif|avif|bmp|x-ms-bmp)$/i;
const BACKFILL_MAX_BYTES = 48 * 1024 * 1024;
// 32,768 chunks × 4 MiB = 128 GiB, far beyond anything a GitHub repo can hold.
const MAX_CHUNKS = 32768;

/** Whether this browser can make thumbnails from an image of this type. */
export function canMakeThumbnails(mimeType: string): boolean {
  return BACKFILL_DECODABLE.test(mimeType);
}

function readIndex(reader: RepoReader): Promise<MediaIndexEntry[]> {
  return reader.readJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH);
}

/** manifest/media-index.json at `commitSha` (the branch head when omitted): one raw read. */
export async function readMediaIndex(repo: RepoRef, commitSha?: string): Promise<MediaIndexEntry[]> {
  const bytes = await getContentBinary(repo, MEDIA_INDEX_PATH, commitSha);
  return parseJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH, bytes ? utf8Text(bytes) : null);
}

export interface IndexSync {
  unchanged: boolean;
  sha: string;
  /** The whole index at `sha`, when it moved past `sinceSha`. */
  index?: MediaIndexEntry[];
}

// Last ref answer per repo + branch, so the head check can be an ETag revalidation.
const heads = new Map<string, { etag: string; sha: string }>();

/** Sync check: the head sha (a 304 when unchanged costs no rate limit), plus the index read at exactly that sha when it differs from `sinceSha`. */
export async function syncMediaIndex(repo: RepoRef, sinceSha?: string): Promise<IndexSync> {
  const key = `${repo.owner}/${repo.repo}@${repo.branch}`;
  const memo = heads.get(key);
  const head = await getHead(repo, memo?.etag);
  let sha: string;
  if (head.modified) {
    sha = head.sha;
    if (head.etag) heads.set(key, { etag: head.etag, sha });
    else heads.delete(key);
  } else if (memo) {
    sha = memo.sha;
  } else {
    const fresh = await getHead(repo);
    if (!fresh.modified) throw new Error("GitHub didn't return the branch head");
    sha = fresh.sha;
  }
  if (sinceSha && sinceSha === sha) return { unchanged: true, sha };
  return { unchanged: false, sha, index: await readMediaIndexRevalidated(repo, key, sha) };
}

// Last manifest read per repo + branch. The branch also moves for People saves,
// album edits and other devices' commits that leave the manifest alone; then its
// ETag still matches and GitHub answers 304 (free) instead of resending the file.
const indexReads = new Map<string, { etag: string; entries: MediaIndexEntry[] }>();

async function readMediaIndexRevalidated(repo: RepoRef, key: string, sha: string): Promise<MediaIndexEntry[]> {
  const memo = indexReads.get(key);
  const res = await githubFetch(
    repo.token,
    repoPath(repo.owner, repo.repo, `/contents/${encodePath(MEDIA_INDEX_PATH)}?ref=${encodeURIComponent(sha)}`),
    { raw: true, etag: memo?.etag }
  );
  if (res.status === 304 && memo) return memo.entries.slice();
  if (res.status === 404) {
    indexReads.delete(key);
    return [];
  }
  if (!res.ok) throw await githubErrorFrom(res);
  const entries = parseJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH, utf8Text(new Uint8Array(await res.arrayBuffer())));
  const etag = res.headers.get("etag");
  if (etag) indexReads.set(key, { etag, entries: entries.slice() });
  else indexReads.delete(key);
  return entries;
}

/** One metadata/<id>.json record (null when it doesn't exist). */
export async function readMediaRecord(repo: RepoRef, id: string, signal?: AbortSignal): Promise<MediaRecord | null> {
  if (!isMediaId(id)) return null;
  const bytes = await getContentBinary(repo, metadataPath(id), undefined, signal);
  if (!bytes) return null;
  try {
    return JSON.parse(utf8Text(bytes)) as MediaRecord;
  } catch {
    return null;
  }
}

export interface UploadCheck {
  /** Chunk hashes with no objects/ file yet — the ones the client must upload. */
  missing: string[];
  /** Id of an indexed item with the same whole-file hash; nothing needs uploading then. */
  duplicateOf: string | null;
  /** The duplicate has no capture date: give it this file's with setTakenAtIfMissing. */
  duplicateNeedsDate?: boolean;
  /** The duplicate is in Trash: adding the file again should restore it (restoreMedia). */
  duplicateTrashed?: boolean;
}

/** Duplicate check plus which chunks are missing; a duplicate needs no upload, so `missing` is []. */
export async function checkUpload(
  repo: RepoRef,
  rawChunkHashes: readonly string[],
  rawFileHash?: string
): Promise<UploadCheck> {
  if (!Array.isArray(rawChunkHashes) || rawChunkHashes.length > MAX_CHUNKS) {
    throw new RepoError(400, `chunkHashes must be an array of at most ${MAX_CHUNKS} hashes`);
  }
  const chunkHashes = rawChunkHashes.map((hash) => hash.toLowerCase());
  if (!chunkHashes.every(isChunkHash)) throw new RepoError(400, "chunkHashes must be lowercase sha256 hex digests");
  const fileHash = rawFileHash?.toLowerCase();
  if (fileHash !== undefined && !isChunkHash(fileHash)) throw new RepoError(400, "fileHash must be a sha256 hex digest");

  const reader = branchReader(repo);
  if (fileHash) {
    const hash = `sha256:${fileHash}`;
    const existing = (await readIndex(reader)).find((entry) => entry.hash === hash);
    if (existing) {
      const check: UploadCheck = { missing: [], duplicateOf: existing.id, duplicateNeedsDate: !existing.takenAt };
      if (existing.trashedAt) check.duplicateTrashed = true;
      return check;
    }
  }
  const unique = Array.from(new Set(chunkHashes));
  const stored = await reader.existingObjects(unique);
  return { missing: unique.filter((hash) => !stored.has(hash)), duplicateOf: null };
}

/** One chunk or thumbnail (≤ 4 MiB) as a Git blob; returns its blob sha for the commit. */
export async function uploadBlob(repo: RepoRef, bytes: Bytes, hash: string, signal?: AbortSignal): Promise<string> {
  if (!isChunkHash(hash)) throw new RepoError(400, "hash must be the sha256 hex digest of the content");
  if (bytes.length === 0) throw new RepoError(400, "A part of this file is empty");
  if (bytes.length > DEFAULT_CHUNK_SIZE) throw new RepoError(413, `chunks must be at most ${DEFAULT_CHUNK_SIZE} bytes`);
  // Content addressing only holds if the bytes really hash to the path they'll be stored at.
  if ((await sha256HexOf(bytes)) !== hash) {
    throw new RepoError(400, "This file changed while it was uploading. Add it again.", "hash_mismatch");
  }
  return createBlob(repo, bytesToBase64(bytes), signal);
}

export interface CommitUploadInput {
  record: unknown;
  /** Blob shas of chunks uploaded with uploadBlob, keyed by chunk hash. */
  chunkBlobShas?: unknown;
  /** Blob shas of thumbnail webps uploaded the same way, keyed by "320" | "800" | "1600". */
  thumbnailBlobShas?: unknown;
}

export interface CommitUploadResult extends CommitInfo {
  id: string;
  /** The same file (by whole-file hash) was already indexed; nothing was added. */
  duplicate: boolean;
  entry: MediaIndexEntry;
  /** The stored record; null for duplicates. */
  record: MediaRecord | null;
}

type CommitOutcome = Omit<CommitUploadResult, keyof CommitInfo>;

/** One commit for chunks, thumbnails, metadata and index entry; idempotent by hash even under concurrent uploads. */
export async function commitMediaUpload(repo: RepoRef, input: CommitUploadInput): Promise<CommitUploadResult> {
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
      throw new RepoError(409, "Some parts of this file haven't been uploaded yet", "missing_chunks", { missing });
    }
  }

  try {
    const { result, commitSha, parentSha } = await runTransaction<CommitOutcome>(repo, async (snapshot) => {
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
    return { ...result, commitSha, parentSha };
  } catch (err) {
    if (err instanceof TreeWriteError) {
      throw new RepoError(422, "Some uploaded parts are no longer on GitHub — upload them again", "unknown_blob");
    }
    throw err;
  }
}

export interface SetTakenAtResult extends CommitInfo {
  /** False when the item is gone or already had a capture date (which is never overwritten). */
  changed: boolean;
  entry: MediaIndexEntry | null;
}

/**
 * Gives an item uploaded without a capture date (older web uploads) the date
 * a later upload of the same file knew, so it sorts under the day it was taken.
 */
export async function setTakenAtIfMissing(repo: RepoRef, id: string, rawTakenAt: string): Promise<SetTakenAtResult> {
  const takenAt = normalizeDate(rawTakenAt);
  if (!takenAt) throw new RepoError(400, "takenAt must be a plausible ISO 8601 date");
  if (!isMediaId(id)) throw new RepoError(404, "not found");
  const { result, commitSha, parentSha } = await runTransaction(repo, async (snapshot) => {
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
  return { ...result, commitSha, parentSha };
}

export type ThumbnailBackfillStatus = "created" | "skipped" | "failed";

export interface ThumbnailBackfillResult {
  status: ThumbnailBackfillStatus;
  /** size -> repo-relative path (same shape as MediaRecord.thumbnails), when thumbnails exist. */
  thumbnails?: Record<string, string>;
  commit?: CommitInfo;
}

function hasThumbnails(record: MediaRecord): boolean {
  return !!record.thumbnails && Object.keys(record.thumbnails).length > 0;
}

/** Best-effort thumbnails, made in this browser, for an image stored without any; only rate limits, sign-in problems and aborts throw. */
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
  if (!canMakeThumbnails(mimeType) || record.size > BACKFILL_MAX_BYTES) return { status: "skipped" };

  let original: Blob;
  try {
    original = await reconstructMediaClient(repo, record);
  } catch (err) {
    if (githubRetryAfterSeconds(err) !== null || isGitHubAuthError(err) || isAbortError(err)) throw err;
    return { status: "failed" };
  }

  let generated: Awaited<ReturnType<typeof generateThumbnails>>;
  try {
    generated = await generateThumbnails(original);
  } catch {
    return { status: "failed" };
  }

  const thumbShas: Record<string, string> = {};
  for (const thumb of generated) {
    thumbShas[String(thumb.size)] = await createBlob(repo, bytesToBase64(new Uint8Array(await thumb.blob.arrayBuffer())));
  }

  const { result, commitSha, parentSha } = await runTransaction<ThumbnailBackfillResult>(repo, async (snapshot) => {
    const current = await snapshot.readJson<MediaRecord>(metadataPath(mediaId));
    if (!current || current.deletedAt) return { result: { status: "skipped" } };
    if (hasThumbnails(current)) return { result: { status: "skipped", thumbnails: current.thumbnails } };
    const index = await readIndex(snapshot);
    if (!index.some((entry) => entry.id === mediaId)) return { result: { status: "skipped" } };

    const thumbnails: Record<string, string> = {};
    for (const size of Object.keys(thumbShas)) thumbnails[size] = thumbnailPath(mediaId, size);
    const updatedIndex = index.map((entry) => (entry.id === mediaId ? { ...entry, thumb: thumbnails["320"] } : entry));
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
  return { ...result, commit: { commitSha, parentSha } };
}

export interface DeleteMediaResult extends CommitInfo {
  /** Ids that were present and removed; unknown or already-deleted ids are dropped. */
  deletedIds: string[];
}

/** One commit removing the index entries `pick` chooses (read at the commit it builds on), their
 * metadata files and album membership; objects/ stay (chunks may be shared). */
async function deleteEntries(
  repo: RepoRef,
  pick: (entry: MediaIndexEntry) => boolean,
  message: (ids: string[]) => string
): Promise<DeleteMediaResult> {
  const { result, commitSha, parentSha } = await runTransaction<string[]>(repo, async (snapshot) => {
    const index = await readIndex(snapshot);
    const deletedIds = index.filter(pick).map((entry) => entry.id);
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

    return { result: deletedIds, commit: { blobs, message: message(deletedIds) } };
  });

  return { deletedIds: commitSha ? result : [], commitSha, parentSha };
}

/** Deletes for good: one commit removing index entries, metadata files and album membership. */
export async function deleteMedia(repo: RepoRef, ids: readonly string[]): Promise<DeleteMediaResult | null> {
  const requested = new Set(ids.filter(isMediaId));
  if (requested.size === 0) return null;
  return deleteEntries(
    repo,
    (entry) => requested.has(entry.id),
    (deletedIds) => (deletedIds.length === 1 ? `404gb: delete ${deletedIds[0]}` : `404gb: delete ${deletedIds.length} items`)
  );
}

/** Deletes for good those of `ids` that are still in Trash and were moved there at or before
 * `cutoff` (ISO 8601) — checked at the commit it builds on, so an item restored meanwhile stays. */
export async function purgeTrash(
  repo: RepoRef,
  ids: readonly string[],
  cutoff: string
): Promise<DeleteMediaResult | null> {
  const requested = new Set(ids.filter(isMediaId));
  const cutoffTime = Date.parse(cutoff);
  if (requested.size === 0 || Number.isNaN(cutoffTime)) return null;
  return deleteEntries(
    repo,
    (entry) => {
      if (!requested.has(entry.id) || !entry.trashedAt) return false;
      const trashed = Date.parse(entry.trashedAt);
      return !Number.isNaN(trashed) && trashed <= cutoffTime;
    },
    (deletedIds) =>
      deletedIds.length === 1
        ? `404gb: purge ${deletedIds[0]} from trash`
        : `404gb: purge ${deletedIds.length} items from trash`
  );
}

export interface EntryChangeResult extends CommitInfo {
  /** Index entries of the requested ids that exist, after the change. */
  entries: MediaIndexEntry[];
}

interface EntryChange {
  /** The changed entry, or null when this one needs no change. */
  entry(entry: MediaIndexEntry): MediaIndexEntry | null;
  record(record: MediaRecord): MediaRecord;
  message(ids: string[]): string;
}

/** Changes index entries and their metadata records together, in one commit. */
async function changeEntries(repo: RepoRef, ids: readonly string[], change: EntryChange): Promise<EntryChangeResult | null> {
  const requested = new Set(ids.filter(isMediaId));
  if (requested.size === 0) return null;

  const { result, commitSha, parentSha } = await runTransaction<MediaIndexEntry[]>(repo, async (snapshot) => {
    const index = await readIndex(snapshot);
    const changed = new Set<string>();
    const updatedIndex = index.map((entry) => {
      if (!requested.has(entry.id)) return entry;
      const next = change.entry(entry);
      if (!next) return entry;
      changed.add(entry.id);
      return next;
    });
    const entries = updatedIndex.filter((entry) => requested.has(entry.id));
    if (changed.size === 0) return { result: entries };

    const blobs: BlobInput[] = [];
    const records = await snapshot.readTexts(Array.from(changed, metadataPath));
    for (const [path, text] of records) {
      if (text === null) continue;
      let record: MediaRecord;
      try {
        record = JSON.parse(text) as MediaRecord;
      } catch {
        continue;
      }
      blobs.push({ path, text: JSON.stringify(change.record(record), null, 2) });
    }
    blobs.push({ path: MEDIA_INDEX_PATH, text: serializeJsonArray(updatedIndex) });
    return { result: entries, commit: { blobs, message: change.message(Array.from(changed)) } };
  });
  return { entries: result, commitSha, parentSha };
}

function withTrashedAt<T extends { trashedAt?: string }>(item: T, trashedAt: string | null): T {
  const copy = { ...item };
  if (trashedAt) copy.trashedAt = trashedAt;
  else delete copy.trashedAt;
  return copy;
}

/**
 * Moves items to Trash: sets `trashedAt` on their index entries and records, in one commit.
 * They keep their index entry (so the same file is still a duplicate) and their album
 * membership (so restoring is lossless). Items already in Trash keep their original date.
 */
export function trashMedia(
  repo: RepoRef,
  ids: readonly string[],
  trashedAt: string = new Date().toISOString()
): Promise<EntryChangeResult | null> {
  return changeEntries(repo, ids, {
    entry: (entry) => (entry.trashedAt ? null : withTrashedAt(entry, trashedAt)),
    record: (record) => withTrashedAt(record, record.trashedAt ?? trashedAt),
    message: (changed) => (changed.length === 1 ? `404gb: trash ${changed[0]}` : `404gb: trash ${changed.length} items`),
  });
}

/** Takes items out of Trash (clears `trashedAt` on index entries and records), in one commit. */
export function restoreMedia(repo: RepoRef, ids: readonly string[]): Promise<EntryChangeResult | null> {
  return changeEntries(repo, ids, {
    entry: (entry) => (entry.trashedAt ? withTrashedAt(entry, null) : null),
    record: (record) => withTrashedAt(record, null),
    message: (changed) =>
      changed.length === 1 ? `404gb: restore ${changed[0]}` : `404gb: restore ${changed.length} items`,
  });
}

function withFavorite<T extends { favorite?: boolean }>(item: T, favorite: boolean): T {
  const copy = { ...item };
  if (favorite) copy.favorite = true;
  else delete copy.favorite;
  return copy;
}

export interface SetFavoriteResult extends CommitInfo {
  /** Index entries of the requested ids that exist, after the change. */
  entries: MediaIndexEntry[];
}

/** Sets or clears `favorite` on index entries and metadata records, in one commit. */
export async function setFavorite(
  repo: RepoRef,
  ids: readonly string[],
  favorite: boolean
): Promise<SetFavoriteResult | null> {
  const requested = new Set(ids.filter(isMediaId));
  if (requested.size === 0) return null;

  const { result, commitSha, parentSha } = await runTransaction<MediaIndexEntry[]>(repo, async (snapshot) => {
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
  return { entries: result, commitSha, parentSha };
}
