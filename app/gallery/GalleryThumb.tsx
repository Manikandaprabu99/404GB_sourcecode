"use client";

import { useEffect, useState } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";
import MediaPlaceholder from "./MediaPlaceholder";

interface GalleryThumbProps {
  repoKey: string;
  mediaId: string;
  alt: string;
  /** Whether this item has a cached thumbnail at all (see
   * MediaIndexEntry.thumb — thumbnail generation during upload is
   * best-effort and can fail, e.g. an undecodable image). When false, no
   * network request is attempted and a placeholder tile is shown instead of
   * a request that would just 404. */
  hasThumbnail: boolean;
  isVideo?: boolean;
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
  hasThumbnail,
  isVideo,
  className,
}: GalleryThumbProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
    if (!hasThumbnail) return;

    let cancelled = false;
    let ownedUrl: string | null = null;
    const controller = new AbortController();

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
        // No cached/served thumbnail (offline, 404, etc.) — fall back to
        // the placeholder tile rather than leaving a spinner up forever.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    };
  }, [repoKey, mediaId, hasThumbnail]);

  if (!hasThumbnail || failed) {
    return <MediaPlaceholder isVideo={isVideo} className={className} />;
  }

  if (!objectUrl) {
    return <div className={`${className ?? ""} skeleton`} />;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={objectUrl}
      alt={alt}
      loading="lazy"
      className={`${className ?? ""} animate-fade-in`}
    />
  );
}
