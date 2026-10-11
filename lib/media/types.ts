// Pure types and helpers: no server-only imports, so client code can import values from here.

export interface ChunkRef {
  index: number;
  hash: string;
  path: string;
}

export type MediaSource = "web" | "android-backup";

export interface MediaRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  /** When it was uploaded (ISO 8601). */
  createdAt: string;
  /** When it was taken (ISO 8601), from EXIF, video metadata or MediaStore. */
  takenAt?: string;
  width?: number;
  height?: number;
  /** Video only (seconds). Undefined for images. */
  duration?: number;
  hash: string; // "sha256:<hex>"
  chunkSize: number;
  chunks: ChunkRef[];
  thumbnails?: Record<string, string>;
  favorite?: boolean;
  /** Original media id when this is an edited copy. */
  editedFrom?: string;
  source?: MediaSource;
  /** Device folder it was backed up from, relative and without a trailing slash, e.g.
   * "DCIM/Camera", "Pictures/Screenshots", "Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Images".
   * Only phone backups know it; web uploads leave it out. */
  folder?: string;
  /** When it was moved to Trash (ISO 8601). Trashed items stay in the index, so the same
   * file is still recognised as a duplicate, and are removed for good after 30 days. */
  trashedAt?: string;
  deletedAt: string | null;
}

export interface MediaIndexEntry {
  id: string;
  filename: string;
  hash: string;
  mimeType: string;
  createdAt: string;
  takenAt?: string;
  thumb?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  favorite?: boolean;
  editedFrom?: string;
  /** See MediaRecord.folder. */
  folder?: string;
  /** See MediaRecord.trashedAt. */
  trashedAt?: string;
}

export const MEDIA_INDEX_PATH = "manifest/media-index.json";

const MEDIA_ID_PATTERN = /^media_[A-Za-z0-9_-]{1,80}$/;

export function isMediaId(value: unknown): value is string {
  return typeof value === "string" && MEDIA_ID_PATTERN.test(value);
}

/** Repo-relative path for a stored thumbnail: thumbnails/<media-id>/<size>.webp */
export function thumbnailPath(mediaId: string, size: number | string): string {
  return `thumbnails/${mediaId}/${size}.webp`;
}

export function metadataPath(mediaId: string): string {
  return `metadata/${mediaId}.json`;
}

export function makeMediaId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `media_${Date.now().toString(36)}${rand}`;
}

/** The date the gallery sorts and groups by. */
export function mediaDate(item: Pick<MediaIndexEntry, "takenAt" | "createdAt">): string {
  return item.takenAt ?? item.createdAt;
}

/** The manifest/media-index.json entry for a record (unset fields omitted). */
export function toIndexEntry(record: MediaRecord): MediaIndexEntry {
  const entry: MediaIndexEntry = {
    id: record.id,
    filename: record.filename,
    hash: record.hash,
    mimeType: record.mimeType,
    createdAt: record.createdAt,
  };
  if (record.takenAt) entry.takenAt = record.takenAt;
  const thumb = record.thumbnails?.["320"];
  if (thumb) entry.thumb = thumb;
  if (record.width) entry.width = record.width;
  if (record.height) entry.height = record.height;
  if (record.duration !== undefined) entry.duration = record.duration;
  if (record.size) entry.size = record.size;
  if (record.favorite) entry.favorite = true;
  if (record.editedFrom) entry.editedFrom = record.editedFrom;
  if (record.folder) entry.folder = record.folder;
  if (record.trashedAt) entry.trashedAt = record.trashedAt;
  return entry;
}
