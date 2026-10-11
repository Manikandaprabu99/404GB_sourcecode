"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { loadThumbnailBlob } from "@/lib/cache";
import { currentRepoKey } from "@/lib/session";
import { decodeImage, type DecodedImage } from "@/lib/editor/decode";
import { alignToDecoded, readImageInfo } from "@/lib/editor/imageInfo";
import { fetchMediaRecord, fetchOriginal } from "@/lib/editor/original";
import type { PreviewSource } from "@/lib/editor/preview";
import type { Size } from "@/lib/editor/types";

export interface OriginalImage {
  blob: Blob;
  mimeType: string;
  /** Upright pixel size of the full-resolution file. */
  natural: Size;
}

export interface EditorSource {
  /** What the stage draws: the large thumbnail at first, then the decoded original. */
  preview: PreviewSource | null;
  original: OriginalImage | null;
  /** 0..1 while the original downloads, null otherwise. */
  progress: number | null;
  error: string | null;
  retry: () => void;
}

/** Long side of the decoded original kept for the live preview (the export re-decodes at full size). */
const PREVIEW_MAX_SIDE = 2560;
const THUMB_SIZES = [1600, 800] as const;

export function useEditorSource(media: MediaIndexEntry): EditorSource {
  const [preview, setPreview] = useState<PreviewSource | null>(null);
  const [original, setOriginal] = useState<OriginalImage | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const shownRef = useRef<DecodedImage | null>(null);
  const hasOriginalRef = useRef(false);

  const show = useCallback((decoded: DecodedImage, id: string) => {
    const previous = shownRef.current;
    shownRef.current = decoded;
    setPreview({ image: decoded.image, width: decoded.width, height: decoded.height, id });
    // Let the stage paint the new image before the old bitmap is released.
    if (previous) requestAnimationFrame(() => requestAnimationFrame(() => previous.close()));
  }, []);

  useEffect(
    () => () => {
      shownRef.current?.close();
      shownRef.current = null;
    },
    []
  );

  // The large thumbnail appears right away, so editing can start while the original downloads.
  useEffect(() => {
    const repoKey = currentRepoKey();
    if (!media.thumb || !repoKey) return;
    let cancelled = false;
    void (async () => {
      for (const size of THUMB_SIZES) {
        try {
          const decoded = await decodeImage(await loadThumbnailBlob(repoKey, media.id, size));
          if (cancelled || hasOriginalRef.current) {
            decoded.close();
          } else {
            show(decoded, `thumb-${size}`);
          }
          return;
        } catch {
          // Try the next size; the original still loads either way.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [media.id, media.thumb, show]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setError(null);
    setProgress(0);
    void (async () => {
      try {
        const record = await fetchMediaRecord(media.id, controller.signal);
        const blob = await fetchOriginal(
          record,
          (fraction) => {
            if (!cancelled) setProgress(fraction);
          },
          controller.signal
        );
        if (cancelled) return;
        const info = await readImageInfo(blob);
        const decoded = await decodeImage(blob, { maxLongSide: PREVIEW_MAX_SIDE, info });
        if (cancelled) {
          decoded.close();
          return;
        }
        hasOriginalRef.current = true;
        show(decoded, "original");
        setOriginal({
          blob,
          mimeType: record.mimeType || blob.type || media.mimeType,
          natural: alignToDecoded(decoded.natural, decoded),
        });
        setProgress(null);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Couldn't load the original photo.");
        setProgress(null);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [media.id, media.mimeType, attempt, show]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { preview, original, progress, error, retry };
}
