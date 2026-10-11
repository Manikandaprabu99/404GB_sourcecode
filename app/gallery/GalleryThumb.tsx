"use client";

import { useEffect, useState } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";
import { backfillThumbnail } from "@/lib/library/mediaStore";
import {
  adoptThumbUrl,
  peekThumbUrl,
  releaseThumbUrl,
  retainThumbUrl,
  thumbKey,
} from "@/lib/library/thumbUrls";
import MediaPlaceholder from "./MediaPlaceholder";

// One backfill attempt per item per page load, however often its tile remounts.
const attemptedBackfillIds = new Set<string>();

interface GalleryThumbProps {
  repoKey: string;
  mediaId: string;
  alt: string;
  /** False when the item was stored without thumbnails: shows a placeholder (and makes
   * them in this browser when it can decode the image) instead of requesting a 404. */
  hasThumbnail: boolean;
  isVideo?: boolean;
  size?: 320 | 800;
  className?: string;
}

/**
 * A thumbnail backed by the IndexedDB cache (lib/cache/thumbnailLoader) and an
 * in-memory object-URL cache (lib/library/thumbUrls), so a remounted tile shows
 * its image on the first frame.
 */
export default function GalleryThumb({
  repoKey,
  mediaId,
  alt,
  hasThumbnail,
  isVideo,
  size = 320,
  className,
}: GalleryThumbProps) {
  const key = thumbKey(repoKey, mediaId, size);
  const [loaded, setLoaded] = useState<{ key: string; url: string; fresh: boolean } | null>(() => {
    const url = hasThumbnail ? peekThumbUrl(key) : null;
    return url ? { key, url, fresh: false } : null;
  });
  const [failedKey, setFailedKey] = useState<string | null>(null);

  useEffect(() => {
    if (hasThumbnail || isVideo) return;
    if (attemptedBackfillIds.has(mediaId)) return;
    attemptedBackfillIds.add(mediaId);
    // Best-effort: on success the library entry gains a thumb and this tile re-renders with it;
    // otherwise the placeholder stays.
    void backfillThumbnail(mediaId);
  }, [mediaId, hasThumbnail, isVideo]);

  useEffect(() => {
    if (!hasThumbnail) return;
    const cached = peekThumbUrl(key);
    if (cached) {
      retainThumbUrl(key);
      setLoaded((prev) => (prev?.key === key && prev.url === cached ? prev : { key, url: cached, fresh: false }));
      return () => releaseThumbUrl(key);
    }

    let cancelled = false;
    let retained = false;
    const controller = new AbortController();
    loadThumbnailObjectUrl(repoKey, mediaId, size, controller.signal)
      .then((url) => {
        // Kept even if this tile already unmounted: scrolling back shows it instantly.
        const adopted = adoptThumbUrl(key, url);
        if (cancelled) return;
        retainThumbUrl(key);
        retained = true;
        setLoaded({ key, url: adopted, fresh: true });
      })
      .catch(() => {
        if (!cancelled) setFailedKey(key);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (retained) releaseThumbUrl(key);
    };
  }, [key, repoKey, mediaId, size, hasThumbnail]);

  if (!hasThumbnail || failedKey === key) {
    return <MediaPlaceholder isVideo={isVideo} className={className} />;
  }

  if (!loaded || loaded.key !== key) {
    return <div className={`${className ?? ""} skeleton`} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={loaded.url}
      alt={alt}
      draggable={false}
      decoding="async"
      className={`${className ?? ""} ${loaded.fresh ? "animate-fade-in" : ""}`}
    />
  );
}
