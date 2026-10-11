"use client";

import { useEffect, useState } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";
import {
  adoptThumbUrl,
  peekThumbUrl,
  releaseThumbUrl,
  retainThumbUrl,
  thumbKey,
} from "@/lib/library/thumbUrls";
import MediaPlaceholder from "./MediaPlaceholder";

// One backfill request per item per page load, however often its tile remounts.
const attemptedBackfillIds = new Set<string>();

interface GalleryThumbProps {
  repoKey: string;
  mediaId: string;
  alt: string;
  /** False when the item was stored without thumbnails: shows a placeholder
   * (and asks the server to generate them) instead of requesting a 404. */
  hasThumbnail: boolean;
  isVideo?: boolean;
  size?: 320 | 800;
  className?: string;
  /** Called with the new 320px thumbnail path after a server-side backfill. */
  onThumbnailBackfilled?: (mediaId: string, thumbPath: string) => void;
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
  size: requestedSize = 320,
  className,
  onThumbnailBackfilled,
}: GalleryThumbProps) {
  // Older items may only have the 320px thumbnail: fall back to it when 800 is missing.
  const [missing800, setMissing800] = useState(false);
  const size = requestedSize === 800 && missing800 ? 320 : requestedSize;
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

    let cancelled = false;
    fetch(`/api/media/${encodeURIComponent(mediaId)}/thumbnail/backfill`, { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; thumbnails?: Record<string, string> } | null) => {
        if (cancelled || !data?.ok) return;
        const path = data.thumbnails?.["320"];
        if (path) onThumbnailBackfilled?.(mediaId, path);
      })
      .catch(() => {
        // Best-effort: the placeholder stays, exactly as if generation had failed.
      });
    return () => {
      cancelled = true;
    };
  }, [mediaId, hasThumbnail, isVideo, onThumbnailBackfilled]);

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
        if (cancelled) return;
        if (size === 800) setMissing800(true);
        else setFailedKey(key);
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
