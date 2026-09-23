// Client-side (browser) mirror of lib/media/index.ts's reconstructMedia.
//
// The server-side version fetches every chunk and Buffer.concat()s them into
// one in-memory file, then returns that as a single HTTP response body. That
// works for small files but is fundamentally incompatible with Vercel
// Functions' hard 4.5 MB response-body cap for anything bigger (see
// docs/ARCHITECTURE.md's "Vercel Functions Body-Size Cap" section) — a GB-
// scale video can never come back as one response, no matter how it's
// chunked internally.
//
// This module does the equivalent reconstruction in the browser instead:
// fetch each chunk individually via GET /api/media/chunk/:hash (each
// response is a single ≤4 MiB object, safely under the cap), concatenate
// them client-side into one Blob, and verify the result's SHA-256 against
// the record's whole-file hash — exactly the same integrity check the old
// server-side route used to do, just run after the browser has all the
// bytes instead of before the server sends them.
"use client";

import type { MediaRecord } from "@/lib/media";
import { mapWithConcurrency } from "@/lib/concurrency";
import { sha256Hex } from "@/lib/chunking";

/** Mirrors CHUNK_FETCH_CONCURRENCY in lib/media/index.ts's reconstructMedia. */
const CHUNK_FETCH_CONCURRENCY = 4;

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

/**
 * Fetches every chunk of `record` via /api/media/chunk/:hash (bounded
 * concurrency), reassembles them in order into one Blob, and verifies the
 * result against `record.hash`. Throws MediaIntegrityError if the hash
 * doesn't match, or a plain Error if a chunk fetch fails.
 *
 * Ordering/concatenation mirrors lib/media/index.ts's reconstructMedia
 * exactly: chunks are sorted by `index` first, and `mapWithConcurrency`
 * preserves each result's position by index regardless of which network
 * request finishes first, so out-of-order arrivals never scramble the
 * final byte order.
 */
export async function reconstructMediaClient(
  record: MediaRecord,
  onProgress?: (progress: ReconstructProgress) => void
): Promise<Blob> {
  const ordered = [...record.chunks].sort((a, b) => a.index - b.index);
  const bytesTotal = record.size;
  let bytesDone = 0;
  let chunksDone = 0;

  onProgress?.({ chunksDone: 0, chunksTotal: ordered.length, bytesDone: 0, bytesTotal });

  const parts = await mapWithConcurrency(ordered, CHUNK_FETCH_CONCURRENCY, async (chunk) => {
    const res = await fetch(`/api/media/chunk/${encodeURIComponent(chunk.hash)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? `Failed to fetch chunk ${chunk.hash} (${res.status})`);
    }
    const blob = await res.blob();
    bytesDone += blob.size;
    chunksDone += 1;
    onProgress?.({ chunksDone, chunksTotal: ordered.length, bytesDone, bytesTotal });
    return blob;
  });

  const reassembled = new Blob(parts, { type: record.mimeType });

  const actualHash = `sha256:${await sha256Hex(await reassembled.arrayBuffer())}`;
  if (actualHash !== record.hash) {
    throw new MediaIntegrityError(record.hash, actualHash);
  }

  return reassembled;
}

export interface ReconstructedMedia {
  url: string;
  blob: Blob;
  /** Revokes the object URL. Callers must call this when done with the URL
   * (e.g. when the viewer closes or navigates away) to avoid leaking the
   * blob for the lifetime of the page — these can be GB-scale. */
  revoke: () => void;
}

/** Same as reconstructMediaClient, but also wraps the result in a revocable
 * object URL ready to hand to an <img>/<video> src or a download link. */
export async function reconstructMediaClientUrl(
  record: MediaRecord,
  onProgress?: (progress: ReconstructProgress) => void
): Promise<ReconstructedMedia> {
  const blob = await reconstructMediaClient(record, onProgress);
  const url = URL.createObjectURL(blob);
  return { url, blob, revoke: () => URL.revokeObjectURL(url) };
}
