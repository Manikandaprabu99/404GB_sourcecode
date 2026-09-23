// Storage-engine-ish module: chunking + hashing logic.
// Uses the browser SubtleCrypto API for per-chunk hashes, and an incremental
// pure-JS SHA-256 (js-sha256) for the whole-file hash so large files (e.g.
// hundreds of MB of video) are never fully buffered in memory at once —
// each chunk is read via File.slice()+arrayBuffer(), fed into the running
// whole-file hash, then dropped, one chunk at a time.

import { sha256 as sha256Incremental } from "js-sha256";

// 4 MiB, not 5: chunks now travel to /api/media/upload/chunk as raw bytes
// (no base64 inflation — see lib/upload/uploadQueue.ts), and Vercel Functions
// enforce a hard, non-configurable 4.5 MB cap on inbound request bodies
// (https://vercel.com/docs/functions/limitations). 4 MiB leaves real headroom
// under that cap for HTTP overhead instead of cutting it close.
export const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB
/** How many chunk uploads may be in flight at once (Section 20 Phase 3). */
export const DEFAULT_UPLOAD_CONCURRENCY = 3;

// Vercel Functions cap RESPONSE bodies at the same hard, non-configurable
// 4.5 MB the request-body cap above enforces
// (https://vercel.com/docs/functions/limitations) — so
// /api/media/object/:id can only safely return a whole file in one response
// if it's under this. This reuses DEFAULT_CHUNK_SIZE itself on purpose: a
// file this size or smaller is at most a single chunk, so returning it
// directly is exactly as safe as returning one chunk already is (see
// /api/media/chunk/:hash). Anything bigger must be fetched chunk-by-chunk
// and reconstructed client-side — see lib/media/reconstructClient.ts and
// docs/ARCHITECTURE.md's "Vercel Functions Body-Size Cap" section.
export const MAX_DIRECT_FETCH_BYTES = DEFAULT_CHUNK_SIZE; // 4 MiB

export interface ChunkInfo {
  index: number;
  hash: string; // hex sha256, no "sha256:" prefix (prefix added at metadata write time)
  blob: Blob;
  size: number;
}

export interface ChunkedFile {
  fileHash: string;
  chunkSize: number;
  chunks: ChunkInfo[];
}

/** SHA-256 hex digest of an ArrayBuffer, via the browser SubtleCrypto API.
 * Exported (not just used internally by chunkFile) so callers that need to
 * verify a whole reassembled file's hash — e.g.
 * lib/media/reconstructClient.ts checking against MediaRecord.hash — reuse
 * this instead of reimplementing digest-to-hex. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash the whole file (dedup key) and split it into fixed-size, hashed
 * chunks. Streams via File.slice(): only one chunk's bytes are held in
 * memory at a time (plus the small, constant-size running hash state for
 * the whole-file digest) — never the whole file at once, so this is safe
 * for large video files.
 */
export async function chunkFile(
  file: File | Blob,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  onProgress?: (bytesHashed: number, totalBytes: number) => void
): Promise<ChunkedFile> {
  const wholeHash = sha256Incremental.create();

  const chunks: ChunkInfo[] = [];
  let offset = 0;
  let index = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    const blob = file.slice(offset, end);
    const buf = await blob.arrayBuffer();
    const [hash] = await Promise.all([
      sha256Hex(buf),
      Promise.resolve(wholeHash.update(buf)),
    ]);
    chunks.push({ index, hash, blob, size: blob.size });
    offset = end;
    index += 1;
    onProgress?.(offset, file.size);
  }

  return { fileHash: wholeHash.hex(), chunkSize, chunks };
}

/** Reassemble chunk Blobs (already fetched, in order) into one Blob. */
export function reassembleChunks(chunkBlobs: Blob[], mimeType: string): Blob {
  return new Blob(chunkBlobs, { type: mimeType });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
