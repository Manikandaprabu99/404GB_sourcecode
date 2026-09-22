import {
  commitBlobs,
  getContentJson,
  getDefaultBranch,
  objectPathForHash,
  contentsExists,
  getContentBinary,
} from "@/lib/github";

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

/** Fetch and reassemble a media record's chunks into one Buffer, in order. */
export async function reconstructMedia(
  accessToken: string,
  owner: string,
  repo: string,
  record: MediaRecord
): Promise<Buffer> {
  const ordered = [...record.chunks].sort((a, b) => a.index - b.index);
  const parts: Buffer[] = [];
  for (const chunk of ordered) {
    const bytes = await getContentBinary(accessToken, owner, repo, chunk.path);
    if (!bytes) {
      throw new Error(`Missing chunk object at ${chunk.path}`);
    }
    parts.push(Buffer.from(bytes));
  }
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
