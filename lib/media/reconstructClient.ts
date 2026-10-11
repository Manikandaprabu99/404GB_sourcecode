// Reassembles an original in the browser: every chunk is fetched (bounded concurrency,
// each one SHA-256 verified by lib/media/chunks), concatenated in index order, and the
// whole file is checked against the record's hash before anyone sees it.

import { sha256 as sha256Incremental } from "js-sha256";
import { mapWithConcurrency } from "@/lib/concurrency";
import { sha256HexOf, type RepoRef } from "@/lib/github";
import { fetchChunk } from "./chunks";
import type { MediaRecord } from "./types";

const CHUNK_FETCH_CONCURRENCY = 4;
// Above this the whole-file hash runs incrementally instead of on one big contiguous copy.
const CONTIGUOUS_HASH_MAX_BYTES = 64 * 1024 * 1024;

export class MediaIntegrityError extends Error {
  constructor(public expected: string, public actual: string) {
    super(
      `Reconstructed file failed integrity check (expected ${expected}, got ${actual}) — the download may be corrupt, try again.`
    );
    this.name = "MediaIntegrityError";
  }
}

export interface ReconstructProgress {
  chunksDone: number;
  chunksTotal: number;
  bytesDone: number;
  bytesTotal: number;
}

async function wholeFileHash(parts: Uint8Array<ArrayBuffer>[], size: number): Promise<string> {
  if (size <= CONTIGUOUS_HASH_MAX_BYTES) {
    const all = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      all.set(part, offset);
      offset += part.byteLength;
    }
    return sha256HexOf(all);
  }
  const hash = sha256Incremental.create();
  for (const part of parts) hash.update(part);
  return hash.hex();
}

/**
 * Fetches every chunk of `record`, reassembles them in order into one Blob, and verifies
 * the result against `record.hash`. Throws MediaIntegrityError on a mismatch.
 * mapWithConcurrency keeps each result at its index, so out-of-order arrivals never
 * scramble the byte order.
 */
export async function reconstructMediaClient(
  repo: RepoRef,
  record: MediaRecord,
  onProgress?: (progress: ReconstructProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const ordered = [...record.chunks].sort((a, b) => a.index - b.index);
  const bytesTotal = record.size;
  const chunksTotal = ordered.length;
  let bytesDone = 0;
  let chunksDone = 0;
  const report = () => onProgress?.({ chunksDone, chunksTotal, bytesDone, bytesTotal });

  report();
  const parts = await mapWithConcurrency(ordered, CHUNK_FETCH_CONCURRENCY, async (chunk) => {
    const bytes = await fetchChunk(repo, chunk.hash, {
      signal,
      onBytes: (delta) => {
        bytesDone += delta;
        report();
      },
    });
    chunksDone += 1;
    report();
    return bytes;
  });

  // A single chunk named by the file's own hash was verified as it arrived.
  const verified = ordered.length === 1 && `sha256:${ordered[0].hash}` === record.hash;
  if (!verified) {
    const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const actualHash = `sha256:${await wholeFileHash(parts, size)}`;
    if (actualHash !== record.hash) throw new MediaIntegrityError(record.hash, actualHash);
  }
  return new Blob(parts, { type: record.mimeType });
}
