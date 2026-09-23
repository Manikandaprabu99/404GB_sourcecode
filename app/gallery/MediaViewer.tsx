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
  /** Deletes the current item (see lib/media.deleteMedia).
   * Must throw on failure so the trash button can show an inline error
   * instead of silently doing nothing; on success the caller is expected to
   * close the viewer itself (the underlying `items` list has just shrunk,
   * so `index` can no longer be trusted to point at the right item). */
  onDelete: (id: string) => Promise<void>;
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={`animate-spin ${className ?? ""}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Full-screen overlay viewer. Loads progressively: the already-cached 320px
 * thumbnail appears instantly, the 800px thumbnail swaps in as soon as it's
 * fetched, and the original full-resolution file is fetched on demand —
 * automatically, the moment the viewer opens, for an image that has no
 * thumbnail at all (see the auto-load effect below: there's nothing smaller
 * to progressively show in that case, so making the user click an extra
 * "View full resolution" button first would just be an extra step before
 * seeing the photo they already tapped); still explicitly on-demand (a
 * button click) for everything else — an image that already has a
 * thumbnail to show instantly, and video (always button-gated — playback
 * has its own controls anyway).
 */
export default function MediaViewer({
  items,
  index,
  onClose,
  onNavigate,
  onDelete,
}: MediaViewerProps) {
  const item = items[index];
  const isVideo = item?.mimeType?.startsWith("video/");
  // Thumbnail generation during upload is best-effort (see
  // lib/upload/uploadQueue.ts) — some items have none at all.
  const hasThumb = Boolean(item?.thumb);
  // An image with no thumbnail has nothing to progressively show — see the
  // auto-load effect below and the component doc comment above.
  const isNoThumbImage = !isVideo && !hasThumb;
  const [stage, setStage] = useState<"thumb" | "medium" | "original">("thumb");
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  // Mirrors `loadingOriginal` but updates synchronously (refs, unlike
  // state, take effect immediately rather than on the next render) — see
  // loadOriginal()'s guard and the item-reset effect below for why the
  // state value alone isn't safe to gate re-entrancy on.
  const loadingOriginalRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    loadingOriginalRef.current = false;
    setOriginalSrc(null);
    setOriginalError(null);
    setReconstructProgress(null);
    setDeleteError(null);
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
    // Gate re-entrancy on the ref, not the `loadingOriginal` state variable:
    // when the viewer navigates to a new item, the item-reset effect above
    // and this component's no-thumbnail-image auto-load effect both fire
    // within the same commit, in that order. The auto-load effect calls
    // this function from a closure captured during that render, which still
    // sees the *old* item's `loadingOriginal` (state updates don't apply
    // until the next render) — checking that stale value here would wrongly
    // skip starting the new item's load and leave it stuck on "Loading
    // photo…" forever. The ref, by contrast, was already flipped back to
    // false by the reset effect earlier in this same commit, so it's always
    // current by the time this guard runs.
    if (loadingOriginalRef.current) return;
    loadingOriginalRef.current = true;
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
      loadingOriginalRef.current = false;
      setLoadingOriginal(false);
    }
  }

  // Auto-load for the no-thumbnail-image case (see the component doc
  // comment above): the moment the viewer opens on such an item, kick off
  // the exact same reconstruction the manual "View full resolution" button
  // uses elsewhere, instead of sitting on the placeholder until the user
  // clicks something. Runs once per item — [item?.id] rather than
  // [isNoThumbImage] — because isNoThumbImage is itself derived from `item`
  // and only actually changes when the item does; declared after the reset
  // effect above so it always runs against that effect's freshly-cleared
  // state (stage/originalError/etc reset to their "nothing loaded yet"
  // values first). Not applicable to video — see the doc comment above.
  useEffect(() => {
    if (!item || !isNoThumbImage) return;
    void loadOriginal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, isNoThumbImage]);

  async function handleDelete() {
    if (deleting || !item) return;
    if (!window.confirm(`Delete "${item.filename}"? This can't be undone from the gallery.`)) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(item.id);
      // On success the parent closes the viewer itself (see the onDelete
      // prop doc comment) — nothing left to do here, and this component may
      // already be unmounting by the time this line would otherwise run.
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
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
  // request to a thumbnail path that doesn't exist. Video keeps this exact
  // behavior (placeholder until the user presses "Play video" — unaffected
  // by the auto-load change above); the no-thumbnail *image* case is
  // rendered separately below (loading spinner / retry) instead of a bare
  // placeholder, since it's now loading automatically rather than waiting
  // on a click.
  const showPlaceholder = isVideo && !hasThumb && stage !== "original";

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
            aria-label="Delete"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors duration-180 hover:bg-red-500/20 hover:text-red-400 disabled:opacity-50"
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? <SpinnerIcon /> : <TrashIcon />}
          </button>
          <button
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white transition-colors duration-180 hover:bg-white/10"
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {deleteError && (
        <div className="px-4 pb-2 text-small text-red-400" onClick={(e) => e.stopPropagation()}>
          {deleteError}
        </div>
      )}

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
      {originalError && !isNoThumbImage && (
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
          ) : isNoThumbImage && stage !== "original" ? (
            <div
              className="flex flex-col items-center gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <MediaPlaceholder
                isVideo={false}
                className="h-64 w-64 max-h-[50vh] max-w-[50vh] rounded-lg"
              />
              {originalError ? (
                <div className="flex max-w-xs flex-col items-center gap-3 text-center">
                  <p className="text-small text-red-400">{originalError}</p>
                  <button
                    className="rounded-full border border-white/20 px-4 py-2 text-small font-medium text-white transition-colors duration-180 hover:bg-white/10"
                    onClick={() => void loadOriginal()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-small text-neutral-300">
                  <SpinnerIcon />
                  <span>
                    {reconstructPct !== null ? `Reconstructing… ${reconstructPct}%` : "Loading photo…"}
                  </span>
                </div>
              )}
            </div>
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
