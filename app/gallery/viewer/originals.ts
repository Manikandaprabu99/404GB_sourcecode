"use client";

// Original-file loading: one download per item for all callers, finished files kept in a small LRU.

import { DEFAULT_CHUNK_SIZE } from "@/lib/chunking";
import { ApiError, withRepo } from "@/lib/library/api";
import { readMediaRecord, type MediaIndexEntry, type MediaRecord } from "@/lib/media";
import { fetchChunk } from "@/lib/media/chunks";
import { reconstructMediaClient } from "@/lib/media/reconstructClient";
import { isChunkHash } from "@/lib/media/validate";

export interface OriginalEntry {
  id: string;
  blob: Blob;
  url: string;
}

/** What the viewer shows for the current item's original. */
export interface OriginalView {
  id: string;
  status: "loading" | "ready" | "error";
  url?: string;
  progress: number | null;
  error?: string;
}

export type ProgressListener = (fraction: number | null) => void;

interface Inflight {
  promise: Promise<OriginalEntry>;
  listeners: Set<ProgressListener>;
}

const MAX_ENTRIES = 3;
const MAX_BYTES = 400 * 1024 * 1024;

/** The chunk that is the whole file, for files small enough to be stored as one chunk (its
 * name is then the file's own hash, so the index entry is enough to fetch it). */
function singleChunkHash(item: MediaIndexEntry): string | null {
  if (!item.size || item.size > DEFAULT_CHUNK_SIZE || !item.hash?.startsWith("sha256:")) return null;
  const hash = item.hash.slice("sha256:".length);
  return isChunkHash(hash) ? hash : null;
}

export class OriginalStore {
  private entries = new Map<string, OriginalEntry>();
  private inflight = new Map<string, Inflight>();
  private records = new Map<string, MediaRecord>();
  private recordRequests = new Map<string, Promise<MediaRecord>>();
  private pinned = new Set<string>();
  private disposed = false;

  /** Items eviction must never drop (the one on screen and the one being prefetched). */
  pin(ids: Iterable<string>): void {
    this.pinned = new Set(ids);
  }

  peek(id: string): OriginalEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  cachedRecord(id: string): MediaRecord | null {
    return this.records.get(id) ?? null;
  }

  record(id: string): Promise<MediaRecord> {
    const cached = this.records.get(id);
    if (cached) return Promise.resolve(cached);
    let request = this.recordRequests.get(id);
    if (!request) {
      request = withRepo((repo) => readMediaRecord(repo, id))
        .then((media) => {
          if (!media) throw new ApiError("not-found", "Not found.", 404);
          this.records.set(id, media);
          return media;
        })
        .finally(() => this.recordRequests.delete(id));
      this.recordRequests.set(id, request);
    }
    return request;
  }

  load(item: MediaIndexEntry, onProgress?: ProgressListener): Promise<OriginalEntry> {
    const hit = this.peek(item.id);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(item.id);
    if (running) {
      if (onProgress) running.listeners.add(onProgress);
      return running.promise;
    }
    const listeners = new Set<ProgressListener>(onProgress ? [onProgress] : []);
    const report: ProgressListener = (fraction) => listeners.forEach((listener) => listener(fraction));
    const promise = this.fetchOriginal(item, report)
      .then((blob) => {
        if (this.disposed) throw new Error("The viewer was closed.");
        const entry: OriginalEntry = { id: item.id, blob, url: URL.createObjectURL(blob) };
        this.entries.set(item.id, entry);
        this.evict(item.id);
        return entry;
      })
      .finally(() => this.inflight.delete(item.id));
    this.inflight.set(item.id, { promise, listeners });
    return promise;
  }

  /** Frees one file early (big videos once the viewer moves on). */
  release(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.url);
    this.entries.delete(id);
  }

  dispose(): void {
    this.disposed = true;
    this.entries.forEach((entry) => URL.revokeObjectURL(entry.url));
    this.entries.clear();
  }

  private async fetchOriginal(item: MediaIndexEntry, report: ProgressListener): Promise<Blob> {
    report(null);
    const single = singleChunkHash(item);
    if (single && item.size) {
      const size = item.size;
      let received = 0;
      try {
        // One request, verified against the file's own hash; no metadata read needed.
        return await withRepo(async (repo) => {
          const bytes = await fetchChunk(repo, single, {
            onBytes: (delta) => {
              received += delta;
              report(Math.min(1, Math.max(0, received / size)));
            },
          });
          return new Blob([bytes], { type: item.mimeType });
        });
      } catch (err) {
        // Stored some other way (it can happen with hand-edited repos): use the record.
        if (!(err instanceof ApiError && err.kind === "not-found")) throw err;
      }
    }
    const record = await this.record(item.id);
    return withRepo((repo) =>
      reconstructMediaClient(repo, record, (p) => report(p.bytesTotal > 0 ? Math.max(0, p.bytesDone / p.bytesTotal) : null))
    );
  }

  private evict(keepId: string): void {
    let bytes = 0;
    this.entries.forEach((entry) => {
      bytes += entry.blob.size;
    });
    for (const [id, entry] of Array.from(this.entries)) {
      if (this.entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      if (id === keepId || this.pinned.has(id)) continue;
      URL.revokeObjectURL(entry.url);
      this.entries.delete(id);
      bytes -= entry.blob.size;
    }
  }
}

export function isAuthError(err: unknown): boolean {
  if (err instanceof ApiError) return err.kind === "auth";
  return err instanceof Error && /signed out|sign-in expired|sign in again/i.test(err.message);
}

/** One friendly sentence for a failed load, download or share. */
export function describeLoadError(err: unknown, fallback = "Couldn't load this. Try again."): string {
  if (isAuthError(err)) return "You're signed out. Sign in again to continue.";
  if (err instanceof ApiError) {
    if (err.kind === "offline") return "You're offline. Connect to the internet and try again.";
    if (err.kind === "rate-limit") return err.message;
    if (err.kind === "not-found") return "This item couldn't be found. It may have been deleted.";
    if (err.code === "integrity") return "The download didn't come through intact. Try again.";
    return fallback;
  }
  if (err instanceof TypeError) return "You seem to be offline. Check your connection and try again.";
  return fallback;
}
