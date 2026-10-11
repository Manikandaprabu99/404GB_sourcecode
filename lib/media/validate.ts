import { DEFAULT_CHUNK_SIZE } from "@/lib/chunking";
import { objectPathForHash, RepoError } from "@/lib/github";
import { THUMBNAIL_SIZES } from "@/lib/thumbnails";
import { isMediaId, makeMediaId, thumbnailPath, type ChunkRef, type MediaRecord } from "./types";

const CHUNK_HASH = /^[0-9a-f]{64}$/;
const FILE_HASH = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MIME_TYPE = /^(?:image|video)\/[a-z0-9.+-]+$/;
const MAX_FILENAME_LENGTH = 255;
const EARLIEST_CAPTURE = Date.UTC(1900, 0, 1);
const FUTURE_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;
const THUMBNAIL_SIZE_KEYS = new Set<string>(THUMBNAIL_SIZES.map(String));

export function isChunkHash(value: unknown): value is string {
  return typeof value === "string" && CHUNK_HASH.test(value);
}

function isGitSha(value: unknown): value is string {
  return typeof value === "string" && GIT_SHA.test(value);
}

/** ISO 8601 string for a parseable, plausible date; undefined otherwise. */
export function normalizeDate(value: unknown, now = Date.now()): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || ms < EARLIEST_CAPTURE || ms > now + FUTURE_TOLERANCE_MS) return undefined;
  return new Date(ms).toISOString();
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function sanitizeFilename(value: unknown): string {
  const name = typeof value === "string" ? value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim() : "";
  return name.slice(0, MAX_FILENAME_LENGTH) || "untitled";
}

function normalizeChunks(raw: unknown, size: number, chunkSize: number): ChunkRef[] {
  const expected = Math.ceil(size / chunkSize);
  if (!Array.isArray(raw) || raw.length !== expected) {
    throw new RepoError(400, `record.chunks must list ${expected} chunk(s) for this size and chunkSize`);
  }
  const chunks = raw.map((item): ChunkRef => {
    const c = (item ?? {}) as { index?: unknown; hash?: unknown };
    const hash = typeof c.hash === "string" ? c.hash.toLowerCase() : c.hash;
    if (typeof c.index !== "number" || !Number.isInteger(c.index) || !isChunkHash(hash)) {
      throw new RepoError(400, "Each record chunk needs an integer index and a sha256 hex hash");
    }
    return { index: c.index, hash, path: objectPathForHash(hash) };
  });
  chunks.sort((a, b) => a.index - b.index);
  if (chunks.some((chunk, i) => chunk.index !== i)) {
    throw new RepoError(400, "record.chunks indexes must run 0..n-1 without gaps");
  }
  return chunks;
}

/** Keeps entries whose key passes `isKey` and whose value is a git blob sha. */
export function pickBlobShas(raw: unknown, isKey: (key: string) => boolean): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = key.toLowerCase();
    if (isKey(normalizedKey) && isGitSha(value)) result[normalizedKey] = value;
  }
  return result;
}

export function pickThumbnailShas(raw: unknown): Record<string, string> {
  return pickBlobShas(raw, (key) => THUMBNAIL_SIZE_KEYS.has(key));
}

/** The canonical copy of an upload record (paths rebuilt, junk dropped); a 400 RepoError for anything corrupting. */
export function normalizeUploadRecord(
  raw: unknown,
  thumbnailBlobShas: Record<string, string>,
  now = Date.now()
): MediaRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new RepoError(400, "record is required");
  }
  const r = raw as Record<string, unknown>;

  const hash = typeof r.hash === "string" ? r.hash.toLowerCase() : "";
  if (!FILE_HASH.test(hash)) throw new RepoError(400, "record.hash must be sha256:<64 hex chars>");

  const mimeType = typeof r.mimeType === "string" ? r.mimeType.trim().toLowerCase() : "";
  if (!MIME_TYPE.test(mimeType)) throw new RepoError(400, "record.mimeType must be an image or video type");

  const size = r.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    throw new RepoError(400, "record.size must be a positive integer");
  }
  const chunkSize = r.chunkSize;
  if (
    typeof chunkSize !== "number" ||
    !Number.isSafeInteger(chunkSize) ||
    chunkSize <= 0 ||
    chunkSize > DEFAULT_CHUNK_SIZE
  ) {
    throw new RepoError(400, `record.chunkSize must be between 1 and ${DEFAULT_CHUNK_SIZE} bytes`);
  }

  const id = isMediaId(r.id) ? r.id : makeMediaId();
  const thumbnails: Record<string, string> = {};
  for (const sizeKey of Object.keys(thumbnailBlobShas)) thumbnails[sizeKey] = thumbnailPath(id, sizeKey);

  const createdAt = normalizeDate(r.createdAt, now) ?? new Date(now).toISOString();
  const duration =
    typeof r.duration === "number" && Number.isFinite(r.duration) && r.duration >= 0 ? r.duration : undefined;

  return {
    id,
    filename: sanitizeFilename(r.filename),
    mimeType,
    size,
    createdAt,
    takenAt: normalizeDate(r.takenAt, now),
    width: positiveInt(r.width),
    height: positiveInt(r.height),
    duration: mimeType.startsWith("video/") ? duration : undefined,
    hash,
    chunkSize,
    chunks: normalizeChunks(r.chunks, size, chunkSize),
    thumbnails,
    favorite: r.favorite === true ? true : undefined,
    editedFrom: isMediaId(r.editedFrom) ? r.editedFrom : undefined,
    source: r.source === "web" || r.source === "android-backup" ? r.source : undefined,
    deletedAt: null,
  };
}

/** Rebuilds a record for a new id (thumbnail paths embed the id). */
export function withMediaId(record: MediaRecord, id: string): MediaRecord {
  const thumbnails: Record<string, string> = {};
  for (const sizeKey of Object.keys(record.thumbnails ?? {})) thumbnails[sizeKey] = thumbnailPath(id, sizeKey);
  return { ...record, id, thumbnails };
}
