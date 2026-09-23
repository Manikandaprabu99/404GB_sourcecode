import {
  commitBlobs,
  commitBlobsWithManifestUpdate,
  createBlob,
  getContentJson,
  getDefaultBranch,
  objectPathForHash,
  contentsExists,
  getContentBinary,
  type BlobInput,
} from "@/lib/github";
import { mapWithConcurrency } from "@/lib/concurrency";
// Constant only — safe to import into this server-side module (see the
// backfillThumbnailIfMissing doc comment below for why the rest of that
// client-oriented module is never pulled in at runtime here).
import { THUMBNAIL_SIZES } from "@/lib/thumbnails";
// Type-only: `sharp` itself is loaded via a runtime `await import("sharp")`
// inside backfillThumbnailIfMissing (see its doc comment for why), but its
// .d.ts uses `export =`, which TypeScript's dynamic-`import()` typing
// doesn't synthesize a `.default` for the way a static default import gets
// one — hence importing just the type here under its own name and casting
// the dynamic import's result to it below.
import type SharpModule from "sharp";

/** How many chunk objects to fetch from GitHub in parallel when
 * reconstructing a media file (Section 20 Phase 4 — Performance). Previously
 * this was a sequential for-loop (one chunk at a time), which meant a large
 * video with many 5 MiB chunks paid its full network round-trip latency N
 * times over instead of ~N/CONCURRENCY times. */
const CHUNK_FETCH_CONCURRENCY = 4;

export interface ChunkRef {
  index: number;
  hash: string;
  path: string;
}

export interface MediaRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  width?: number;
  height?: number;
  /** Video only (seconds). Undefined for images. */
  duration?: number;
  hash: string; // "sha256:<hex>"
  chunkSize: number;
  chunks: ChunkRef[];
  thumbnails?: Record<string, string>;
  deletedAt: string | null;
}

export interface MediaIndexEntry {
  id: string;
  filename: string;
  hash: string;
  mimeType: string;
  createdAt: string;
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** Repo-relative path for a stored thumbnail: thumbnails/<media-id>/<size>.webp */
export function thumbnailPath(mediaId: string, size: number | string): string {
  return `thumbnails/${mediaId}/${size}.webp`;
}

export function makeMediaId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `media_${Date.now().toString(36)}${rand}`;
}

/** Read manifest/media-index.json (returns [] if not yet created). */
export async function readMediaIndex(
  accessToken: string,
  owner: string,
  repo: string
): Promise<MediaIndexEntry[]> {
  const data = await getContentJson<MediaIndexEntry[]>(
    accessToken,
    owner,
    repo,
    "manifest/media-index.json"
  );
  return data ?? [];
}

/** Read one metadata/<id>.json record. */
export async function readMediaRecord(
  accessToken: string,
  owner: string,
  repo: string,
  id: string
): Promise<MediaRecord | null> {
  return getContentJson<MediaRecord>(
    accessToken,
    owner,
    repo,
    `metadata/${id}.json`
  );
}

/**
 * Fetch and reassemble a media record's chunks into one Buffer, in order.
 * Chunks are fetched with bounded concurrency rather than one at a time —
 * `mapWithConcurrency` preserves output order by index, so concatenation is
 * still correct regardless of which request lands first.
 */
export async function reconstructMedia(
  accessToken: string,
  owner: string,
  repo: string,
  record: MediaRecord
): Promise<Buffer> {
  const ordered = [...record.chunks].sort((a, b) => a.index - b.index);
  const parts = await mapWithConcurrency(
    ordered,
    CHUNK_FETCH_CONCURRENCY,
    async (chunk) => {
      const bytes = await getContentBinary(accessToken, owner, repo, chunk.path);
      if (!bytes) {
        throw new Error(`Missing chunk object at ${chunk.path}`);
      }
      return Buffer.from(bytes);
    }
  );
  return Buffer.concat(parts);
}

/** Which of the given chunk hashes are missing from objects/. */
export async function findMissingChunkHashes(
  accessToken: string,
  owner: string,
  repo: string,
  hashes: string[]
): Promise<string[]> {
  const missing: string[] = [];
  for (const hash of hashes) {
    const exists = await contentsExists(
      accessToken,
      owner,
      repo,
      objectPathForHash(hash)
    );
    if (!exists) missing.push(hash);
  }
  return missing;
}

export interface CommitUploadInput {
  record: MediaRecord;
  /** Git blob shas for chunks already uploaded via /api/media/upload/chunk, keyed by chunk hash. */
  chunkBlobShas: Record<string, string>;
  /** Git blob shas for thumbnail webp images already uploaded via /api/media/upload/chunk,
   *  keyed by size ("320" | "800" | "1600"). */
  thumbnailBlobShas?: Record<string, string>;
}

/**
 * Single commit covering: new chunk objects (only the missing ones) +
 * metadata/<id>.json + updated manifest/media-index.json.
 */
export async function commitMediaUpload(
  accessToken: string,
  owner: string,
  repo: string,
  input: CommitUploadInput
): Promise<string> {
  const branch = await getDefaultBranch(accessToken, owner, repo);

  const currentIndex = await readMediaIndex(accessToken, owner, repo);
  const newEntry: MediaIndexEntry = {
    id: input.record.id,
    filename: input.record.filename,
    hash: input.record.hash,
    mimeType: input.record.mimeType,
    createdAt: input.record.createdAt,
    thumb: input.record.thumbnails?.["320"],
    width: input.record.width,
    height: input.record.height,
    duration: input.record.duration,
  };
  const updatedIndex = [...currentIndex, newEntry];

  const blobs = [
    ...Object.entries(input.chunkBlobShas).map(([hash, sha]) => ({
      path: objectPathForHash(hash),
      sha,
    })),
    ...Object.entries(input.thumbnailBlobShas ?? {}).map(([size, sha]) => ({
      path: thumbnailPath(input.record.id, size),
      sha,
    })),
    {
      path: `metadata/${input.record.id}.json`,
      base64Content: Buffer.from(
        JSON.stringify(input.record, null, 2)
      ).toString("base64"),
    },
    {
      path: "manifest/media-index.json",
      base64Content: Buffer.from(
        JSON.stringify(updatedIndex, null, 2)
      ).toString("base64"),
    },
  ];

  return commitBlobs(
    accessToken,
    owner,
    repo,
    branch,
    blobs,
    `404gb: upload ${input.record.filename}`
  );
}

export type ThumbnailBackfillStatus = "created" | "skipped" | "failed";

export interface ThumbnailBackfillResult {
  status: ThumbnailBackfillStatus;
  /** Present only when status is "created" — size -> repo-relative path,
   * same shape as MediaRecord.thumbnails. */
  thumbnails?: Record<string, string>;
}

/**
 * Server-side thumbnail fallback (Section 20 follow-up, 2026-09-23).
 *
 * Client-side thumbnail generation (lib/thumbnails: browser
 * createImageBitmap()/<img>.decode(), see uploadQueue.ts) is inherently
 * best-effort — some real-world photos still fail to decode in a browser
 * canvas even with that module's resize-hint + <img>-fallback strategies.
 * `sharp` (libvips) decodes a much wider range of real-world images
 * reliably, including large ones, so this is a second attempt run
 * server-side (Vercel's Node serverless runtime, not Edge) rather than
 * another client-side patch.
 *
 * Used two ways:
 *  1. Immediately after a fresh upload's commit, when the client reports an
 *     empty thumbnail map (POST /api/media/upload/commit).
 *  2. On demand for items ALREADY stored without a thumbnail — e.g. ones
 *     uploaded before this fallback existed — via
 *     POST /api/media/:id/thumbnail/backfill, which
 *     app/gallery/GalleryThumb.tsx calls, once per item per session,
 *     whenever it renders a placeholder for an image.
 *
 * Best-effort in both cases: if `sharp` itself also can't decode the file
 * (rare — e.g. a genuinely corrupt upload), thumbnails are left empty
 * exactly as they already are today, no error is thrown, and the caller (an
 * API route) turns this into a 200 with `status: "failed"` rather than a
 * 500 — the placeholder simply keeps showing, same as before this feature
 * existed.
 *
 * NOTE on bundling: this function does a runtime `await import("sharp")`
 * (not a static `import ... from "sharp"` at the top of this file) so a
 * decode failure or the package being unavailable can be caught with an
 * ordinary try/catch, same as every other decode strategy in this file.
 * `sharp` itself must never be reachable from client bundles — it isn't:
 * every "use client" component that needs types from this module does
 * `import type { MediaRecord, ... }`, and the only runtime importers of
 * this file's value exports are `app/api/**\/route.ts` handlers, which
 * Next.js always compiles for the server only.
 */
export async function backfillThumbnailIfMissing(
  accessToken: string,
  owner: string,
  repo: string,
  mediaId: string
): Promise<ThumbnailBackfillResult> {
  const record = await readMediaRecord(accessToken, owner, repo, mediaId);
  if (!record) return { status: "skipped" };
  if (record.deletedAt) return { status: "skipped" };
  if (!record.mimeType.startsWith("image/")) return { status: "skipped" };
  if (record.thumbnails && Object.keys(record.thumbnails).length > 0) {
    return { status: "skipped" };
  }

  let sharpFactory: typeof SharpModule;
  try {
    const mod = await import("sharp");
    sharpFactory = (mod as unknown as { default: typeof SharpModule }).default;
  } catch {
    // Package not installed/available in this runtime — nothing to do.
    return { status: "failed" };
  }

  let original: Buffer;
  try {
    original = await reconstructMedia(accessToken, owner, repo, record);
  } catch {
    // Couldn't even fetch the chunks back (missing object, network) — leave
    // thumbnails empty, same as a client-side generation failure would.
    return { status: "failed" };
  }

  const generated: Array<{ size: (typeof THUMBNAIL_SIZES)[number]; buffer: Buffer }> = [];
  try {
    for (const size of THUMBNAIL_SIZES) {
      const buffer = await sharpFactory(original)
        .rotate() // respect EXIF orientation instead of baking in a sideways thumbnail
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      generated.push({ size, buffer });
    }
  } catch {
    // Genuinely undecodable by sharp too (e.g. a corrupt file) — best-effort,
    // not a hard requirement (see doc comment above).
    return { status: "failed" };
  }

  const branch = await getDefaultBranch(accessToken, owner, repo);

  const thumbBlobShas: Record<string, string> = {};
  for (const { size, buffer } of generated) {
    thumbBlobShas[String(size)] = await createBlob(
      accessToken,
      owner,
      repo,
      buffer.toString("base64")
    );
  }

  const thumbnailPaths: Record<string, string> = {};
  for (const size of Object.keys(thumbBlobShas)) {
    thumbnailPaths[size] = thumbnailPath(mediaId, size);
  }

  const updatedRecord: MediaRecord = { ...record, thumbnails: thumbnailPaths };

  const currentIndex = await readMediaIndex(accessToken, owner, repo);
  const updatedIndex = currentIndex.map((entry) =>
    entry.id === mediaId ? { ...entry, thumb: thumbnailPaths["320"] } : entry
  );

  const blobs: BlobInput[] = [
    ...Object.entries(thumbBlobShas).map(([size, sha]) => ({
      path: thumbnailPath(mediaId, size),
      sha,
    })),
    {
      path: `metadata/${mediaId}.json`,
      base64Content: Buffer.from(JSON.stringify(updatedRecord, null, 2)).toString("base64"),
    },
    {
      path: "manifest/media-index.json",
      base64Content: Buffer.from(JSON.stringify(updatedIndex, null, 2)).toString("base64"),
    },
  ];

  await commitBlobs(
    accessToken,
    owner,
    repo,
    branch,
    blobs,
    `404gb: backfill thumbnail for ${record.filename}`
  );

  return { status: "created", thumbnails: thumbnailPaths };
}

export interface DeleteMediaResult {
  /** Ids that were actually present in the index and removed. A caller-
   * supplied id that no longer exists (already deleted, or never did) is
   * silently dropped from this list rather than erroring the whole call. */
  deletedIds: string[];
  /** Null when deletedIds is empty — nothing changed, so no commit was made. */
  commitSha: string | null;
}

/**
 * Deletes one or more media items (docs/ARCHITECTURE.md Section 7 / the
 * product spec's Section 16): removes each id's entry from
 * manifest/media-index.json (so the gallery grid and full-screen viewer,
 * which both read from this index, immediately stop showing it) and removes
 * its metadata/<id>.json file from the tree entirely, via the Git Data
 * API's create-tree "sha: null deletes this path" mechanism (see
 * lib/github.commitBlobs' `delete` flag) — NOT a literal
 * octokit.repos.deleteFile call, which would be its own separate commit per
 * path.
 *
 * Deliberately does NOT touch anything under objects/ or thumbnails/. Chunk
 * objects are content-addressed by hash and may be shared by other
 * surviving records via upload-time dedup (see lib/chunking and the
 * upload/init missing-chunk check), so only a future garbage-collection
 * pass ("Storage Cleanup" — Section 16 of the product spec, see this repo's
 * docs/ARCHITECTURE.md Section 6's "Push/fetch bandwidth" note) that
 * verifies no surviving record still references a chunk should ever remove
 * one. Because this function only ever removes the specific id(s)
 * requested and never touches objects/, deleting a dedup-shared item is
 * correct by construction — the other record(s) still referencing that
 * chunk hash are untouched and keep working.
 *
 * Batches everything into a single commit regardless of how many ids are
 * passed, same pattern as commitMediaUpload — one network round trip
 * whether this is a single-item delete (the viewer's trash button) or a
 * multi-select bulk delete (the gallery grid's selection toolbar).
 *
 * The manifest read-modify-write goes through
 * lib/github.commitBlobsWithManifestUpdate rather than a plain
 * readMediaIndex(...) + commitBlobs(...) pair: the latter reads the index
 * once up front, but commitBlobs independently re-fetches whatever the
 * branch's *actual* current tree is right before committing, so a commit
 * that landed in that window (e.g. a concurrent upload from another tab)
 * would have its manifest change silently reverted by this delete even
 * though the delete's own commit still lands cleanly as a valid
 * fast-forward. commitBlobsWithManifestUpdate reads the index from the
 * exact tree it's about to commit against and retries the whole
 * read+recompute if the branch head moves before it can land, so the
 * removal is always computed from an up-to-date snapshot.
 */
export async function deleteMedia(
  accessToken: string,
  owner: string,
  repo: string,
  ids: string[]
): Promise<DeleteMediaResult> {
  const requested = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
  if (requested.length === 0) return { deletedIds: [], commitSha: null };
  const idSet = new Set(requested);

  const branch = await getDefaultBranch(accessToken, owner, repo);

  let deletedIds: string[] = [];

  const commitSha = await commitBlobsWithManifestUpdate<MediaIndexEntry>(
    accessToken,
    owner,
    repo,
    branch,
    "manifest/media-index.json",
    (freshIndex, pathExists) => {
      deletedIds = freshIndex.filter((entry) => idSet.has(entry.id)).map((entry) => entry.id);
      if (deletedIds.length === 0) {
        // None of the requested ids are actually present in the index as of
        // this exact attempt's snapshot (already deleted, or bad ids) —
        // nothing to change, so don't create an empty commit.
        return null;
      }

      const remainingIndex = freshIndex.filter((entry) => !idSet.has(entry.id));

      // GitHub's create-tree API errors if asked to delete a path that
      // isn't actually present in base_tree — guard against an index entry
      // whose metadata file is already gone for some other reason (the
      // index removal above still stands either way). `pathExists` checks
      // against the same tree snapshot the commit is based on, so this is
      // race-free too, unlike a separate contentsExists() call per id would
      // be.
      const blobs: BlobInput[] = deletedIds
        .map((id) => `metadata/${id}.json`)
        .filter((path) => pathExists(path))
        .map((path) => ({ path, delete: true as const }));

      return {
        blobs,
        updatedManifest: remainingIndex,
        commitMessage:
          deletedIds.length === 1
            ? `404gb: delete ${deletedIds[0]}`
            : `404gb: delete ${deletedIds.length} items`,
      };
    }
  );

  if (commitSha === null) return { deletedIds: [], commitSha: null };
  return { deletedIds, commitSha };
}
