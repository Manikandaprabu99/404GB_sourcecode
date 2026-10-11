// Client-side helper: load a thumbnail, preferring the IndexedDB cache and falling back to
// GitHub — with bounded concurrency so a large gallery scrolling into view doesn't fire
// hundreds of simultaneous requests at once.

import { Semaphore } from "@/lib/concurrency";
import { getContentBinary } from "@/lib/github";
import { withRepo } from "@/lib/library/api";
import { thumbnailPath } from "@/lib/media/types";
import { getCachedThumbnail, putCachedThumbnail } from "./thumbnailCache";

/** How many thumbnail downloads may be in flight at once, across the whole app
 * (every mounted thumbnail competes for the same budget). */
const THUMBNAIL_FETCH_CONCURRENCY = 6;
const semaphore = new Semaphore(THUMBNAIL_FETCH_CONCURRENCY);

export type ThumbnailSize = 320 | 800 | 1600;

/** The thumbnail webp of `mediaId` in the library `repoKey`; rejects when it doesn't exist. */
export async function loadThumbnailBlob(
  repoKey: string,
  mediaId: string,
  size: ThumbnailSize,
  signal?: AbortSignal
): Promise<Blob> {
  const cached = await getCachedThumbnail(repoKey, mediaId, size);
  if (cached) return cached;

  const release = await semaphore.acquire();
  try {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const bytes = await withRepo(
      (repo) => getContentBinary(repo, thumbnailPath(mediaId, size), undefined, signal),
      repoKey
    );
    if (!bytes) throw new Error(`no ${size}px thumbnail for ${mediaId}`);
    const blob = new Blob([bytes], { type: "image/webp" });
    // Not awaited: showing the image shouldn't wait for the cache write.
    putCachedThumbnail(repoKey, mediaId, size, blob).catch(() => {});
    return blob;
  } finally {
    release();
  }
}

/**
 * Resolves to an object URL for the given thumbnail. Caller owns the URL
 * and must call `URL.revokeObjectURL` on it when done (e.g. on unmount).
 */
export async function loadThumbnailObjectUrl(
  repoKey: string,
  mediaId: string,
  size: ThumbnailSize,
  signal?: AbortSignal
): Promise<string> {
  return URL.createObjectURL(await loadThumbnailBlob(repoKey, mediaId, size, signal));
}
