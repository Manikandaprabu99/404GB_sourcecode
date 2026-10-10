"use client";

import type { MediaRecord } from "@/lib/media";
import { MAX_DIRECT_FETCH_BYTES } from "@/lib/chunking";
import { reconstructMediaClient } from "@/lib/media/reconstructClient";

export class OriginalLoadError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "OriginalLoadError";
  }
}

async function loadError(res: Response, fallback: string): Promise<OriginalLoadError> {
  if (res.status === 401) return new OriginalLoadError("You're signed out. Sign in again to edit this photo.", 401);
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof body?.error === "string" ? body.error : `${fallback} (${res.status})`;
  return new OriginalLoadError(message, res.status);
}

export async function fetchMediaRecord(id: string, signal?: AbortSignal): Promise<MediaRecord> {
  const res = await fetch(`/api/media/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) throw await loadError(res, "Couldn't load this photo");
  const body = (await res.json()) as { media?: MediaRecord };
  if (!body.media) throw new OriginalLoadError("Couldn't load this photo");
  return body.media;
}

/** The original file: one request when small enough, otherwise chunk by chunk (SHA-256 verified). */
export async function fetchOriginal(
  record: MediaRecord,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (record.size > MAX_DIRECT_FETCH_BYTES) {
    return reconstructMediaClient(record, (p) => onProgress(p.bytesTotal ? p.bytesDone / p.bytesTotal : 0));
  }
  const res = await fetch(`/api/media/object/${encodeURIComponent(record.id)}`, { signal });
  if (!res.ok) throw await loadError(res, "Couldn't download the original");
  if (!res.body) {
    const blob = await res.blob();
    onProgress(1);
    return blob;
  }
  const total = Number(res.headers.get("Content-Length")) || record.size || 1;
  const reader = res.body.getReader();
  const parts: BlobPart[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress(Math.min(1, received / total));
  }
  return new Blob(parts, { type: record.mimeType });
}
