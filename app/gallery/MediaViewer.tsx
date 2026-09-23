"use client";

import { useEffect, useRef, useState } from "react";
import type { MediaIndexEntry, MediaRecord } from "@/lib/media";
import { MAX_DIRECT_FETCH_BYTES } from "@/lib/chunking";
import { reconstructMediaClientUrl, type ReconstructProgress } from "@/lib/media/reconstructClient";
import MediaPlaceholder from "./MediaPlaceholder";

interface MediaViewerProps {
  items: MediaIndexEntry[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

// Matches the CSS transition/animation durations used for the overlay's
// open/close below — kept as one constant so the deferred `onClose` call
// (which unmounts this component) always waits for the exit animation to
// actually finish painting.
const CLOSE_ANIMATION_MS = 180;

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Full-screen overlay viewer. Loads progressively: the already-cached 320px
 * thumbnail appears instantly, the 800px thumbnail swaps in as soon as it's
 * fetched, and the original full-resolution file is only fetched if the
 * viewer explicitly requests it (reconstructing chunks server-side is not
 * cheap, so it's on-demand rather than automatic).
 */
export default function MediaViewer({
  items,
  index,
  onClose,
  onNavigate,
}: MediaViewerProps) {
  const item = items[index];
  const isVideo = item?.mimeType?.startsWith("video/");
  // Thumbnail generation during upload is best-effort (see
  // lib/upload/uploadQueue.ts) — some items have none at all.
  const hasThumb = Boolean(item?.thumb);
  const [stage, setStage] = useState<"thumb" | "medium" | "original">("thumb");
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [closing, setClosing] = useState(false);

  // Full-resolution / video-playback loading. `record` (fetched on demand
  // from GET /api/media/:id, which is where `size`/`chunks`/`hash` live —
  // the lightweight MediaIndexEntry in `items` doesn't carry them) decides
  // the fast path (record.size under the Vercel response-body cap: fetch
  // /api/media/object/:id directly, one round trip) vs the chunked path
  // (fetch+reassemble client-side via lib/media/reconstructClient.ts) — see
  // docs/ARCHITECTURE.md's "Vercel Functions Body-Size Cap" section.
  const [originalSrc, setOriginalSrc] = useState<string | null>(null);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const [reconstructProgress, setReconstructProgress] = useState<ReconstructProgress | null>(null);
  // Tracks the object URL created by client-side reconstruction so it can be
  // revoked (these can be GB-scale) once it's no longer needed.
  const objectUrlRef = useRef<string | null>(null);
  const recordRef = useRef<MediaRecord | null>(null);

  // Direction-aware slide: +1 when moving to a later photo, -1 when moving
  // back, 0 on the very first mount (no slide-in on open, the overlay fade
  // already covers that entrance).
  const prevIndexRef = useRef(index);
  const [slideDir, setSlideDir] = useState(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
    } else {
      setSlideDir(index > prevIndexRef.current ? 1 : index < prevIndexRef.current ? -1 : 0);
    }
    prevIndexRef.current = index;
  }, [index]);

  useEffect(() => {
    setStage("thumb");
    setLoadingOriginal(false);
    setOriginalSrc(null);
    setOriginalError(null);
    setReconstructProgress(null);
    recordRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, [item?.id]);

  // Revoke any outstanding reconstructed object URL when the viewer itself
  // unmounts (the per-item effect above already handles navigating between
  // items while it stays open).
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function preloadImage(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = url;
    });
  }

  async function fetchRecord(): Promise<MediaRecord> {
    if (recordRef.current) return recordRef.current;
    const res = await fetch(`/api/media/${item.id}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? `Failed to load media details (${res.status})`);
    }
    const { media } = (await res.json()) as { media: MediaRecord };
    recordRef.current = media;
    return media;
  }

  /** Loads the full-resolution original (image "view full resolution" and
   * video "play" both call this). Picks the fast direct-fetch path or the
   * client-side chunked-reconstruction path based on the record's size —
   * see the `record` state comment above. */
  async function loadOriginal() {
    if (loadingOriginal) return;
    setLoadingOriginal(true);
    setOriginalError(null);
    setReconstructProgress(null);
    try {
      const rec = await fetchRecord();
      if (rec.size <= MAX_DIRECT_FETCH_BYTES) {
        const directUrl = `/api/media/object/${item.id}`;
        if (!isVideo) {
          // Preload off-DOM first so the viewer doesn't flash a broken
          // image if the fetch fails partway.
          await preloadImage(directUrl);
        }
        setOriginalSrc(directUrl);
      } else {
        const { url } = await reconstructMediaClientUrl(rec, setReconstructProgress);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setOriginalSrc(url);
      }
      setStage("original");
    } catch (err) {
      setOriginalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingOriginal(false);
    }
  }

  useEffect(() => {
    if (!item || isVideo || !hasThumb) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStage((s) => (s === "original" ? s : "medium"));
    };
    img.src = `/api/media/thumb/${item.id}/800`;
    return () => {
      cancelled = true;
    };
  }, [item?.id, isVideo, hasThumb]);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, CLOSE_ANIMATION_MS);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") requestClose();
      else if (e.key === "ArrowRight") onNavigate(Math.min(index + 1, items.length - 1));
      else if (e.key === "ArrowLeft") onNavigate(Math.max(index - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length, closing]);

  if (!item) return null;

  const src =
    stage === "original"
      ? (originalSrc ?? `/api/media/thumb/${item.id}/800`)
      : stage === "medium"
      ? `/api/media/thumb/${item.id}/800`
      : `/api/media/thumb/${item.id}/320`;

  const reconstructPct = reconstructProgress
    ? Math.min(100, Math.round((reconstructProgress.bytesDone / Math.max(1, reconstructProgress.bytesTotal)) * 100))
    : null;
  const originalButtonLabel = loadingOriginal
    ? reconstructPct !== null
      ? `Reconstructing… ${reconstructPct}%`
      : "Loading full res…"
    : null;

  // No cached thumbnail exists for this item (thumbnail generation is
  // best-effort — see uploadQueue.ts) and the original hasn't been
  // requested yet: show a clear placeholder instead of an <img>/poster
  // request to a thumbnail path that doesn't exist.
  const showPlaceholder = !hasThumb && stage !== "original";

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-black/95 transition-opacity duration-180 ease-out-expo ${
        closing ? "opacity-0" : "animate-fade-in opacity-100"
      }`}
      onClick={requestClose}
    >
      <div
        className="flex items-center justify-between gap-4 p-4 pt-safe text-small text-neutral-300"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{item.filename}</span>
        <div className="flex items-center gap-2">
          {stage !== "original" && isVideo && (
            <button
              className="rounded-full border border-white/20 px-3 py-2 text-small text-white transition-colors duration-180 hover:bg-white/10 disabled:opacity-50"
              disabled={loadingOriginal}
              onClick={() => {
                void loadOriginal();
              }}
            >
              {originalButtonLabel ?? "Play video"}
            </button>
          )}
          {stage !== "original" && !isVideo && (
            <button
              className="rounded-full border border-white/20 px-3 py-2 text-small text-white transition-colors duration-180 hover:bg-white/10 disabled:opacity-50"
              disabled={loadingOriginal}
              onClick={() => {
                void loadOriginal();
              }}
            >
              {originalButtonLabel ?? "View full resolution"}
            </button>
          )}
          <button
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors duration-180 hover:bg-white/10"
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {loadingOriginal && reconstructPct !== null && (
        <div
          className="px-4 pb-2 text-small text-neutral-300"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-320 ease-out-expo"
              style={{ width: `${reconstructPct}%` }}
            />
          </div>
          <p className="mt-1 text-micro text-neutral-400">
            Reconstructing original from {reconstructProgress?.chunksTotal} chunks — this can take a
            while for large videos.
          </p>
        </div>
      )}
      {originalError && (
        <div className="px-4 pb-2 text-small text-red-400" onClick={(e) => e.stopPropagation()}>
          {originalError}
        </div>
      )}

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2 sm:px-4">
        {index > 0 && (
          <button
            aria-label="Previous"
            className="absolute left-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-180 hover:bg-black/70 sm:left-3"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index - 1);
            }}
          >
            <ChevronIcon direction="left" />
          </button>
        )}

        <div
          key={item.id}
          style={{ ["--slide-dir" as string]: slideDir }}
          className={slideDir !== 0 ? "animate-slide-in" : "animate-scale-in"}
        >
          {isVideo && stage === "original" && originalSrc ? (
            <video
              src={originalSrc}
              poster={hasThumb ? `/api/media/thumb/${item.id}/1600` : undefined}
              controls
              autoPlay
              className="max-h-[calc(100vh-9rem)] max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          ) : showPlaceholder ? (
            <div onClick={(e) => e.stopPropagation()}>
              <MediaPlaceholder
                isVideo={isVideo}
                className="h-64 w-64 max-h-[50vh] max-w-[50vh] rounded-lg"
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={item.filename}
              className="max-h-[calc(100vh-9rem)] max-w-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>

        {index < items.length - 1 && (
          <button
            aria-label="Next"
            className="absolute right-1 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors duration-180 hover:bg-black/70 sm:right-3"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index + 1);
            }}
          >
            <ChevronIcon direction="right" />
          </button>
        )}
      </div>

      <div className="p-3 pb-safe text-center text-small text-neutral-500">
        {index + 1} / {items.length}
      </div>
    </div>
  );
}
