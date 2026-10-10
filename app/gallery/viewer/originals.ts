"use client";

// Original-file loading for the viewer. One request per item no matter how many
// callers (zoom, download, share) ask for it; finished files are kept as object
// URLs in a small LRU so going back and forth doesn't download them again.

import type { MediaIndexEntry, MediaRecord } from "@/lib/media";
import { MAX_DIRECT_FETCH_BYTES } from "@/lib/chunking";
import { MediaIntegrityError, reconstructMediaClient } from "@/lib/media/reconstructClient";
import { apiJson, ApiError, rateLimitMessage } from "@/lib/library/api";

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

export function objectUrl(mediaId: string): string {
  return `/api/media/object/${encodeURIComponent(mediaId)}`;
}

export class OriginalStore {
  private entries = new Map<string, OriginalEntry>();
  private inflight = new Map<string, Inflight>();
  private records = new Map<string, MediaRecord>();
  private recordRequests = new Map<string, Promise<MediaRecord>>();
  private disposed = false;

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
      request = apiJson<{ media: MediaRecord }>(`/api/media/${encodeURIComponent(id)}`)
        .then(({ media }) => {
          this.records.set(id, media);
          return media;
        })
        .finally(() => this.recordRequests.delete(id));
      this.recordRequests.set(id, request);
    }
    return request;
  }

  /** The one-request URL for files small enough to come back in a single response, else null. */
  async directUrl(item: MediaIndexEntry): Promise<string | null> {
    const size = item.size ?? (await this.record(item.id)).size;
    return size <= MAX_DIRECT_FETCH_BYTES ? objectUrl(item.id) : null;
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
    let size = item.size;
    let record = this.records.get(item.id) ?? null;
    if (size === undefined || size > MAX_DIRECT_FETCH_BYTES) {
      record = await this.record(item.id);
      size = record.size;
    }
    if (size <= MAX_DIRECT_FETCH_BYTES) return fetchWithProgress(objectUrl(item.id), size, item.mimeType, report);
    if (!record) record = await this.record(item.id);
    return reconstructMediaClient(record, (p) => report(p.bytesTotal > 0 ? p.bytesDone / p.bytesTotal : null));
  }

  private evict(keepId: string): void {
    let bytes = 0;
    this.entries.forEach((entry) => {
      bytes += entry.blob.size;
    });
    for (const [id, entry] of Array.from(this.entries)) {
      if (this.entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      if (id === keepId) continue;
      URL.revokeObjectURL(entry.url);
      this.entries.delete(id);
      bytes -= entry.blob.size;
    }
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof payload?.error === "string" ? payload.error : null;
  if (res.status === 401) return new ApiError("auth", "You're signed out.", 401);
  if (res.status === 429) {
    const header = Number(res.headers.get("Retry-After"));
    const retryAfter = Number.isFinite(header) && header > 0 ? header : undefined;
    return new ApiError("rate-limit", rateLimitMessage(retryAfter), 429, retryAfter);
  }
  if (res.status === 404) return new ApiError("not-found", message ?? "Not found.", 404);
  return new ApiError("server", message ?? `Something went wrong (${res.status}).`, res.status);
}

async function fetchWithProgress(
  url: string,
  expectedSize: number,
  mimeType: string,
  report: ProgressListener
): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ApiError("offline", "You're offline.", 0);
  }
  if (!res.ok) throw await errorFromResponse(res);
  const total = Number(res.headers.get("Content-Length")) || expectedSize;
  if (!res.body || !total) {
    const blob = await res.blob();
    return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  }
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    report(Math.min(1, received / total));
  }
  return new Blob(parts, { type: mimeType });
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
    return fallback;
  }
  if (err instanceof MediaIntegrityError) return "The download didn't come through intact. Try again.";
  if (err instanceof TypeError) return "You seem to be offline. Check your connection and try again.";
  return fallback;
}
