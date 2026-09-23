"use client";

import { useEffect, useState } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";
import MediaPlaceholder from "./MediaPlaceholder";

// Session-lived guard against re-firing a backfill request for the same
// item every time it scrolls in and out of the virtualized grid's mounted
// window (VirtualGrid only mounts rows near the viewport, so a given
// GalleryThumb instance mounts/unmounts repeatedly as the user scrolls —
// without this, each remount would re-request a backfill for an item
// that's already known to have none, or whose generation already failed).
// Deliberately a plain module-level Set, not persisted anywhere: it only
// needs to survive for this page session, and a fresh attempt per item on
// the next full page load is the desired behavior, not a bug.
const attemptedBackfillIds = new Set<string>();

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
  /** Called once a server-side thumbnail backfill (see the effect below and
   * lib/media.backfillThumbnailIfMissing) succeeds for this item, with the
   * new 320px thumbnail's repo-relative path — so the parent can update its
   * in-memory item list + IndexedDB cache and this tile re-renders showing
   * the real image instead of the placeholder. Omitted entirely for video
   * items (see the effect below — video posters are out of scope here). */
  onThumbnailBackfilled?: (mediaId: string, thumbPath: string) => void;
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
  onThumbnailBackfilled,
}: GalleryThumbProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Self-healing for images stored with no thumbnail at all (uploaded
  // before the server-side `sharp` fallback existed, or whose client-side
  // generation failed) — see lib/media.backfillThumbnailIfMissing and
  // POST /api/media/:id/thumbnail/backfill. Fire-and-forget: this never
  // blocks or affects what renders below, it just repairs the stored data
  // in the background so a *future* render of this same id shows a real
  // thumbnail. Video is out of scope (video posters are captured
  // client-side at upload time — see lib/media/video.ts — not backfilled
  // here).
  useEffect(() => {
    if (hasThumbnail || isVideo) return;
    if (attemptedBackfillIds.has(mediaId)) return;
    attemptedBackfillIds.add(mediaId);

    let cancelled = false;
    fetch(`/api/media/${mediaId}/thumbnail/backfill`, { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; thumbnails?: Record<string, string> } | null) => {
        if (cancelled || !data?.ok) return;
        const path = data.thumbnails?.["320"];
        if (path) onThumbnailBackfilled?.(mediaId, path);
      })
      .catch(() => {
        // Best-effort — leave the placeholder showing, exactly as if
        // generation had failed client-side too. attemptedBackfillIds
        // already guards against retry-spamming this same id again.
      });

    return () => {
      cancelled = true;
    };
  }, [mediaId, hasThumbnail, isVideo, onThumbnailBackfilled]);

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
