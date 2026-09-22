// IndexedDB cache of thumbnail blobs, keyed by repo + media id + size, so
// repeat gallery visits/scrolls don't re-fetch the same 320px webp from
// GitHub through our API route every time.

import { getDb } from "./db";

function cacheKey(
  repoKey: string,
  mediaId: string,
  size: number | string
): string {
  return `${repoKey}::${mediaId}::${size}`;
}

export async function getCachedThumbnail(
  repoKey: string,
  mediaId: string,
  size: number | string
): Promise<Blob | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const record = await db.get("thumbnails", cacheKey(repoKey, mediaId, size));
    return record?.blob ?? null;
  } catch {
    return null;
  }
}

export async function putCachedThumbnail(
  repoKey: string,
  mediaId: string,
  size: number | string,
  blob: Blob
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.put("thumbnails", {
      cacheKey: cacheKey(repoKey, mediaId, size),
      repoKey,
      mediaId,
      size: String(size),
      blob,
      cachedAt: Date.now(),
    });
  } catch {
    // Best-effort — a failed write just means this thumbnail refetches
    // next time instead of being served from cache.
  }
}
