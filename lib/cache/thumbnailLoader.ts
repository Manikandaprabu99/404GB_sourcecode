// Client-side helper: load a thumbnail as an object URL, preferring the
// IndexedDB cache and falling back to the network — with bounded
// concurrency so a large gallery scrolling into view doesn't fire hundreds
// of simultaneous requests at once (Section 20 Phase 4).

import { Semaphore } from "@/lib/concurrency";
import { getCachedThumbnail, putCachedThumbnail } from "./thumbnailCache";

/** How many thumbnail network fetches may be in flight at once, across the
 * whole gallery (shared module-level semaphore — every mounted thumbnail
 * competes for the same budget). */
const THUMBNAIL_FETCH_CONCURRENCY = 6;
const semaphore = new Semaphore(THUMBNAIL_FETCH_CONCURRENCY);

/**
 * Resolves to an object URL for the given thumbnail. Caller owns the URL
 * and must call `URL.revokeObjectURL` on it when done (e.g. on unmount).
 */
export async function loadThumbnailObjectUrl(
  repoKey: string,
  mediaId: string,
  size: 320 | 800 | 1600,
  signal?: AbortSignal
): Promise<string> {
  const cached = await getCachedThumbnail(repoKey, mediaId, size);
  if (cached) return URL.createObjectURL(cached);

  const release = await semaphore.acquire();
  try {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const res = await fetch(`/api/media/thumb/${mediaId}/${size}`, { signal });
    if (!res.ok) throw new Error(`thumbnail fetch failed (${res.status})`);
    const blob = await res.blob();
    // Don't await the cache write on the critical path of showing the
    // image — but do let failures happen silently in the background.
    putCachedThumbnail(repoKey, mediaId, size, blob).catch(() => {});
    return URL.createObjectURL(blob);
  } finally {
    release();
  }
}
