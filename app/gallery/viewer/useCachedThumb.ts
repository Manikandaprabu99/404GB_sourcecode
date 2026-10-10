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

export function thumbUrl(mediaId: string, size: 320 | 800 | 1600): string {
  return `/api/media/thumb/${encodeURIComponent(mediaId)}/${size}`;
}

/** The grid's thumbnail object URL (ready on the first frame when its tile was on
 * screen); otherwise loaded through the IndexedDB cache and shared with the grid. */
export function useCachedThumb(repoKey: string, mediaId: string, size: 320 | 800, enabled: boolean): string | null {
  const key = thumbKey(repoKey, mediaId, size);
  const [url, setUrl] = useState<string | null>(() => (enabled ? peekThumbUrl(key) : null));

  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    const cached = peekThumbUrl(key);
    if (cached) {
      retainThumbUrl(key);
      setUrl(cached);
      return () => releaseThumbUrl(key);
    }
    let cancelled = false;
    let retained = false;
    const controller = new AbortController();
    loadThumbnailObjectUrl(repoKey, mediaId, size, controller.signal)
      .then((objectUrl) => {
        const adopted = adoptThumbUrl(key, objectUrl);
        if (cancelled) return;
        retainThumbUrl(key);
        retained = true;
        setUrl(adopted);
      })
      .catch(() => {
        if (!cancelled) setUrl(thumbUrl(mediaId, size));
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (retained) releaseThumbUrl(key);
    };
  }, [key, repoKey, mediaId, size, enabled]);

  return url;
}
