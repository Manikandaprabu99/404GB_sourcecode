"use client";

import { useEffect, useState } from "react";
import { loadThumbnailBlob, loadThumbnailObjectUrl, type ThumbnailSize } from "@/lib/cache";
import {
  adoptThumbUrl,
  peekThumbUrl,
  releaseThumbUrl,
  retainThumbUrl,
  thumbKey,
} from "@/lib/library/thumbUrls";

interface ThumbState {
  key: string;
  url: string | null;
  failed: boolean;
}

/** A thumbnail object URL shared with the grid (ready on the first frame when it was on
 * screen), otherwise loaded through the IndexedDB cache. `failed` when it doesn't exist. */
function useThumbUrl(repoKey: string, mediaId: string, size: ThumbnailSize, enabled: boolean): ThumbState {
  const key = thumbKey(repoKey, mediaId, size);
  const [state, setState] = useState<ThumbState>(() => ({
    key,
    url: enabled ? peekThumbUrl(key) : null,
    failed: false,
  }));

  useEffect(() => {
    if (!enabled) {
      setState({ key, url: null, failed: false });
      return;
    }
    const cached = peekThumbUrl(key);
    if (cached) {
      retainThumbUrl(key);
      setState((prev) => (prev.key === key && prev.url === cached ? prev : { key, url: cached, failed: false }));
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
        setState({ key, url: adopted, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ key, url: null, failed: true });
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (retained) releaseThumbUrl(key);
    };
  }, [key, repoKey, mediaId, size, enabled]);

  return state.key === key ? state : { key, url: null, failed: false };
}

/** The grid's 320/800px thumbnail URL, or null while loading or when there is none. */
export function useCachedThumb(repoKey: string, mediaId: string, size: 320 | 800, enabled: boolean): string | null {
  return useThumbUrl(repoKey, mediaId, size, enabled).url;
}

/** The viewer's large preview: the 1600px thumbnail, else the 800px one. */
export function usePreviewThumb(repoKey: string, mediaId: string, enabled: boolean): string | null {
  const large = useThumbUrl(repoKey, mediaId, 1600, enabled);
  const medium = useThumbUrl(repoKey, mediaId, 800, enabled && large.failed);
  return large.url ?? medium.url;
}

/** Warms the cache for a preview the viewer is about to show. */
export function preloadPreviewThumb(repoKey: string, mediaId: string): void {
  void loadThumbnailBlob(repoKey, mediaId, 1600).catch(() => {});
}
