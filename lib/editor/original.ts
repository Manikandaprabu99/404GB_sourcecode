"use client";

import { isAbortError } from "@/lib/github";
import { ApiError, withRepo } from "@/lib/library/api";
import { readMediaRecord, type MediaRecord } from "@/lib/media";
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

function loadError(err: unknown, fallback: string): OriginalLoadError {
  if (err instanceof ApiError) {
    if (err.kind === "auth") return new OriginalLoadError("You're signed out. Sign in again to edit this photo.", 401);
    if (err.kind === "offline") return new OriginalLoadError("You're offline. Connect to the internet and try again.", 0);
    if (err.kind === "rate-limit") return new OriginalLoadError(err.message, 429);
    if (err.kind === "not-found") {
      return new OriginalLoadError("This photo couldn't be found. It may have been deleted.", 404);
    }
    if (err.code === "integrity") return new OriginalLoadError(err.message, err.status);
    return new OriginalLoadError(`${fallback} (${err.status})`, err.status);
  }
  return new OriginalLoadError(fallback);
}

export async function fetchMediaRecord(id: string, signal?: AbortSignal): Promise<MediaRecord> {
  let record: MediaRecord | null;
  try {
    record = await withRepo((repo) => readMediaRecord(repo, id, signal));
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw loadError(err, "Couldn't load this photo");
  }
  if (!record) throw new OriginalLoadError("This photo couldn't be found. It may have been deleted.", 404);
  return record;
}

/** The original file, chunk by chunk from GitHub (each chunk and the whole file SHA-256 verified). */
export async function fetchOriginal(
  record: MediaRecord,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  try {
    return await withRepo((repo) =>
      reconstructMediaClient(
        repo,
        record,
        (p) => onProgress(p.bytesTotal ? Math.min(1, Math.max(0, p.bytesDone / p.bytesTotal)) : 0),
        signal
      )
    );
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw loadError(err, "Couldn't download the original");
  }
}
