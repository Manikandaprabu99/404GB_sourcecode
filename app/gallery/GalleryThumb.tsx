"use client";

import { useEffect, useState } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";

interface GalleryThumbProps {
  repoKey: string;
  mediaId: string;
  alt: string;
  className?: string;
}

/**
 * A 320px gallery thumbnail, backed by the IndexedDB thumbnail cache
 * (lib/cache/thumbnailLoader): checks the cache first, only hits
 * /api/media/thumb/:id/320 on a miss, and caches the result for next time.
 * Only mounted for rows the virtualized grid actually renders, so this is
 * also where the "don't fetch offscreen images" behavior lives.
 */
export default function GalleryThumb({
  repoKey,
  mediaId,
  alt,
  className,
}: GalleryThumbProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ownedUrl: string | null = null;
    const controller = new AbortController();

    setObjectUrl(null);
    loadThumbnailObjectUrl(repoKey, mediaId, 320, controller.signal)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        ownedUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        // Leave the placeholder up on failure (offline, 404, etc).
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [repoKey, mediaId]);

  if (!objectUrl) {
    return <div className={`${className ?? ""} animate-pulse bg-neutral-800`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} loading="lazy" className={className} />;
}
