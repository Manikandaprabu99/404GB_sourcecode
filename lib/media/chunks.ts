// Stored chunks, read in the page: the service worker's verified chunk cache first (filled
// by video streaming and earlier views), then GitHub. Every chunk is checked against its
// SHA-256 before it is used, and fresh downloads are handed to the worker to cache.

import {
  githubFetch,
  GitHubNetworkError,
  githubStatus,
  isAbortError,
  objectPathForHash,
  RepoError,
  sha256HexOf,
  type Bytes,
  type RepoRef,
} from "@/lib/github";
import { encodePath, githubErrorFrom, repoPath } from "@/lib/github/client";
import { CHUNK_CACHE, CHUNK_KEY_PREFIX, postToServiceWorker, STORE_CHUNK_MESSAGE } from "./stream";

const FETCH_ATTEMPTS = 3;

/** A downloaded chunk didn't hash to its name: a transfer problem, so it's retried. */
export class ChunkIntegrityError extends Error {
  constructor(readonly hash: string) {
    super("A part of this file didn't download intact");
    this.name = "ChunkIntegrityError";
  }
}

function chunkKey(hash: string): string {
  return `${self.location.origin}${CHUNK_KEY_PREFIX}${hash}`;
}

async function readCachedChunk(hash: string): Promise<Bytes | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CHUNK_CACHE);
    const res = await cache.match(chunkKey(hash));
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function offerToWorker(hash: string, bytes: Bytes): void {
  const copy = bytes.slice();
  postToServiceWorker({ type: STORE_CHUNK_MESSAGE, hash, bytes: copy }, [copy.buffer]);
}

function concat(parts: Uint8Array[], total: number): Bytes {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function downloadChunk(
  repo: RepoRef,
  hash: string,
  onBytes: (delta: number) => void,
  signal?: AbortSignal
): Promise<Bytes> {
  const path = `/contents/${encodePath(objectPathForHash(hash))}?ref=${encodeURIComponent(repo.branch)}`;
  const res = await githubFetch(repo.token, repoPath(repo.owner, repo.repo, path), { raw: true, signal });
  if (res.status === 404) throw new RepoError(404, "Part of this file is missing from your repo", "missing_chunk");
  if (!res.ok) throw await githubErrorFrom(res);
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onBytes(bytes.byteLength);
    return bytes;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
    onBytes(value.byteLength);
  }
  return concat(parts, total);
}

function retryable(err: unknown): boolean {
  if (err instanceof GitHubNetworkError || err instanceof ChunkIntegrityError) return true;
  const status = githubStatus(err);
  return status !== undefined && status >= 500;
}

/** One verified chunk; `onBytes` reports download progress (negative when a failed attempt is undone). */
export async function fetchChunk(
  repo: RepoRef,
  hash: string,
  options: { onBytes?: (delta: number) => void; signal?: AbortSignal } = {}
): Promise<Bytes> {
  const { onBytes, signal } = options;
  const cached = await readCachedChunk(hash);
  if (cached && (await sha256HexOf(cached)) === hash) {
    onBytes?.(cached.byteLength);
    return cached;
  }

  for (let attempt = 1; ; attempt++) {
    let received = 0;
    try {
      const bytes = await downloadChunk(
        repo,
        hash,
        (delta) => {
          received += delta;
          onBytes?.(delta);
        },
        signal
      );
      if ((await sha256HexOf(bytes)) !== hash) throw new ChunkIntegrityError(hash);
      offerToWorker(hash, bytes);
      return bytes;
    } catch (err) {
      if (received) onBytes?.(-received);
      if (isAbortError(err) || !retryable(err) || attempt >= FETCH_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt * attempt));
    }
  }
}
