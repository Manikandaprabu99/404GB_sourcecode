"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MediaIndexEntry, MediaRecord } from "@/lib/media";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { trapTab, useEscapeLayer, useFocusReturn } from "@/app/components/ui/focus";
import { canEdit } from "@/lib/editor/canEdit";
import { leaveForSignIn } from "@/lib/library/signedOut";
import { daysLeftInTrash, daysLeftLabel } from "@/lib/library/trash";
import { select as selectHaptic } from "@/lib/ui/haptics";
import { hideTile, prefersReducedMotion, revealTile, tileImage, tileRect } from "@/lib/ui/sharedElement";
import Ambient from "./viewer/Ambient";
import ImageSlide from "./viewer/ImageSlide";
import InfoSheet from "./viewer/InfoSheet";
import VideoSlide from "./viewer/VideoSlide";
import { BottomBar, SideArrows, StatusPill, TopBar, type OriginalChipState, type ViewerAction } from "./viewer/ViewerChrome";
import { canDisplayOriginal, isHeic, isVideoItem, viewerTitle } from "./viewer/format";
import { fitBox, type Size } from "./viewer/geometry";
import {
  AlbumAddIcon,
  AlbumRemoveIcon,
  DeleteForeverIcon,
  DownloadIcon,
  EditIcon,
  HeartIcon,
  InfoIcon,
  RestoreIcon,
  ShareIcon,
  Spinner,
  TrashIcon,
} from "./viewer/icons";
import {
  OriginalStore,
  describeLoadError,
  isAuthError,
  type OriginalEntry,
  type OriginalView,
  type ProgressListener,
} from "./viewer/originals";
import { canShareFiles, hasNativeBackup, isShareCancel, nativeTransfer, triggerDownload } from "./viewer/transfer";
import {
  CLOSE_MS,
  OPEN_MS,
  SPRING,
  boxRect,
  containState,
  coverState,
  playFlip,
  toRect,
  type FlipRun,
  type Rect,
} from "./viewer/sharedTransition";
import { preloadPreviewThumb } from "./viewer/useCachedThumb";
import { SLIDE_GAP, useViewerGestures } from "./viewer/useViewerGestures";
import "./viewer/viewer.css";

const PhotoEditor = dynamic(() => import("./PhotoEditor"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-editor flex items-center justify-center bg-black/85 text-white">
      <Spinner size={28} />
    </div>
  ),
});

export interface MediaViewerProps {
  items: MediaIndexEntry[];
  index: number;
  repoKey: string;
  onIndexChange(i: number): void;
  onClose(): void;
  onDelete(ids: string[]): void;
  onFavoriteChange(id: string, favorite: boolean): void;
  onAddToAlbum(ids: string[]): void;
  onEdited?(newMediaId: string | null): void;
  onRemoveFromAlbum?(id: string): void;
  /** Viewing Trash: Restore and Delete forever replace the library's actions. */
  trash?: { onRestore(id: string): void; onDeleteForever(id: string): void };
}

interface Transfer {
  label: string;
  progress: number | null;
}

// Huge originals (100 MP+) load only when zooming; items without thumbnails always load theirs.
const AUTO_ORIGINAL_MAX_PIXELS = 100_000_000;
// How long a photo must stay on screen before its original starts downloading,
// so flicking through many photos doesn't start a download for each one.
const ORIGINAL_DWELL_MS = 300;

function autoLoadsOriginal(entry: MediaIndexEntry): boolean {
  if (isVideoItem(entry) || !canDisplayOriginal(entry)) return false;
  if (!entry.thumb) return true;
  return !(entry.width && entry.height && entry.width * entry.height > AUTO_ORIGINAL_MAX_PIXELS);
}

/** Data Saver on, or a 2G/3G-class connection. */
function savingData(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(connection?.saveData) || /(^|-)(2g|3g)$/.test(connection?.effectiveType ?? "");
}

const FADE_MS = 120;
const LEAVE_MS = 220;
const AUTO_HIDE_MS = 3000;
// Browsers only open the share sheet shortly after a tap.
const SHARE_GESTURE_MS = 4000;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** The sharpest picture the current slide has decoded (the original, else the preview, else the thumbnail). */
function shownImageSrc(stage: HTMLElement | null): string | null {
  const imgs = stage?.querySelectorAll<HTMLImageElement>("[data-viewer-current] img");
  if (!imgs) return null;
  for (let i = imgs.length - 1; i >= 0; i--) {
    const img = imgs[i];
    if (img.complete && img.naturalWidth > 0 && getComputedStyle(img).opacity !== "0") return img.currentSrc || img.src;
  }
  return null;
}

/** Waits (a few frames at most) until the current slide shows a decoded picture, for a flash-free hand-off. */
async function slideReady(stage: HTMLElement | null, maxMs: number): Promise<void> {
  const until = performance.now() + maxMs;
  while (performance.now() < until && !shownImageSrc(stage)) await nextFrame();
}

/** Full-screen viewer: swipe between items, down to close, up for details; pinch or double-tap to zoom.
 * Thumbnail, then preview, then the original; the parent owns data changes. */
export default function MediaViewer(props: MediaViewerProps) {
  const { items, index, repoKey, onAddToAlbum, onRemoveFromAlbum, trash } = props;
  const toast = useToast();
  const confirm = useConfirm();

  const safeIndex = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
  const item: MediaIndexEntry | undefined = items[safeIndex];

  const latest = useRef(props);
  latest.current = props;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexRef = useRef(safeIndex);
  indexRef.current = safeIndex;

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const flipHostRef = useRef<HTMLDivElement>(null);
  // The shared-element zoom (docs/DESIGN.md "Photos — new experiences" 6).
  const openFlipRef = useRef<FlipRun | null>(null);
  const closeFlipRef = useRef<FlipRun | null>(null);
  const enteringRef = useRef(false);
  const openedIdRef = useRef<string | null>(items[safeIndex]?.id ?? null);
  const restoreTileRef = useRef<() => void>(() => {});
  const gesturesRef = useRef<{ cancel(): void; currentZoom(): { x: number; y: number; s: number } } | null>(null);
  const aliveRef = useRef(true);
  const storeRef = useRef<OriginalStore | null>(null);
  const getStore = useCallback(() => (storeRef.current ??= new OriginalStore()), []);

  const [stage, setStage] = useState<Size>(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight }
  );
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const [chromeVisible, setChromeVisible] = useState(true);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeCalledRef = useRef(false);
  const [zoomed, setZoomed] = useState(false);
  const [original, setOriginal] = useState<OriginalView | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const transferBusyRef = useRef(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoRecord, setInfoRecord] = useState<MediaRecord | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [activity, setActivity] = useState(0);
  const [shareable, setShareable] = useState(false);
  const [native, setNative] = useState(false);
  const [favoritePulse, setFavoritePulse] = useState(0);

  const blocked = infoOpen || editing || confirming || closing || leavingId !== null;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      storeRef.current?.dispose();
      storeRef.current = null;
    };
  }, []);

  // ---- closing ------------------------------------------------------------

  const callClose = useCallback(() => {
    if (closeCalledRef.current) return;
    closeCalledRef.current = true;
    latest.current.onClose();
  }, []);

  /** Reduced motion, or nothing to fly: the viewer fades out. */
  const fadeOutAndClose = useCallback(() => {
    const root = rootRef.current;
    if (!root || typeof root.animate !== "function") {
      callClose();
      return;
    }
    root
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: prefersReducedMotion() ? FADE_MS : 200, easing: "ease-out", fill: "forwards" })
      .finished.then(callClose, callClose);
  }, [callClose]);

  /** Shrinks the photo from where it is (`at`: a swipe's release) into its tile, revealing it first.
   * No tile: shrink and fade. Reduced motion: crossfade. */
  const closeAnimated = useCallback(
    async (at?: { x: number; y: number; s: number }) => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      gesturesRef.current?.cancel();
      openFlipRef.current?.remove();
      openFlipRef.current = null;
      const entry = itemsRef.current[indexRef.current];
      const host = flipHostRef.current;
      const stageEl = stageRef.current;
      const backdrop = backdropRef.current;
      const { box, stage: size } = gestureContext.current;
      if (!entry || !host || !stageEl || !backdrop || prefersReducedMotion() || box.w <= 0 || box.h <= 0) {
        fadeOutAndClose();
        return;
      }
      const shown = shownImageSrc(stageEl);
      let rect = tileRect(entry.id);
      if (entry.id !== openedIdRef.current || !rect) {
        if (revealTile(entry.id)) {
          // The grid renders the revealed rows on its next frames.
          for (let i = 0; i < 10; i++) {
            await nextFrame();
            rect = tileRect(entry.id);
            if (rect && i >= 1) break;
          }
        }
      }
      if (!aliveRef.current) return;
      const tile = rect ? tileImage(entry.id) : null;
      const bottom = tile?.src ?? shown;
      if (!bottom) {
        fadeOutAndClose();
        return;
      }
      const aspect = box.w / box.h;
      const zoom = at ?? gesturesRef.current?.currentZoom() ?? { x: 0, y: 0, s: 1 };
      const from = boxRect(box, size, zoom);
      // The tile's own thumbnail underneath; the sharper picture on screen fades out over it.
      const layers: { src: string; opacity?: number[] }[] = [{ src: bottom }];
      if (shown && shown !== bottom) layers.push({ src: shown, opacity: tile ? [1, 1, 0] : undefined });
      let to: Rect;
      if (rect) {
        to = toRect(rect);
      } else {
        // Nowhere to land: carry on in the swipe's direction, or sink back a little.
        const k = at ? 0.78 : 0.9;
        to = {
          left: from.left + (from.width * (1 - k)) / 2,
          top: from.top + (from.height * (1 - k)) / 2 + (at ? size.h * 0.25 : 0),
          width: from.width * k,
          height: from.height * k,
        };
      }
      const duration = rect ? CLOSE_MS : 240;
      stageEl.style.opacity = "0";
      backdrop.style.transition = `opacity ${duration}ms ${SPRING}`;
      backdrop.style.opacity = "0";
      restoreTileRef.current();
      restoreTileRef.current = rect ? hideTile(entry.id) : () => {};
      const run = playFlip({
        host,
        layers,
        aspect,
        from: containState(from),
        to: rect ? coverState(to, aspect) : containState(to),
        duration,
        baseWidth: box.w,
        fadeOut: !rect,
      });
      closeFlipRef.current = run;
      await run.finished;
      // Paint the exact landing frame once before the tile takes over.
      await nextFrame();
      restoreTileRef.current();
      restoreTileRef.current = () => {};
      run.remove();
      callClose();
    },
    [callClose, fadeOutAndClose]
  );

  const requestClose = useCallback(() => void closeAnimated(), [closeAnimated]);

  /** Close right away: the swipe-down animation already played. */
  const closeNow = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    callClose();
  }, [callClose]);

  useHistoryOverlay(true, requestClose);
  useEscapeLayer(!editing, requestClose);
  useFocusReturn(true, rootRef);

  // ---- layout -------------------------------------------------------------

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setStage((s) => (s.w === rect.width && s.h === rect.height ? s : { w: rect.width, h: rect.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const boxFor = useCallback(
    (entry: MediaIndexEntry): Size => {
      const aspect = aspects[entry.id] ?? (entry.width && entry.height ? entry.width / entry.height : null);
      return fitBox(aspect, stage.w, stage.h);
    },
    [aspects, stage.w, stage.h]
  );

  const handleAspect = useCallback((id: string, aspect: number) => {
    setAspects((current) =>
      current[id] !== undefined && Math.abs(current[id] - aspect) < 0.005 ? current : { ...current, [id]: aspect }
    );
  }, []);

  // ---- errors & originals -------------------------------------------------

  const notifyError = useCallback(
    (err: unknown, fallback: string) => {
      if (!aliveRef.current) return;
      if (isAuthError(err)) {
        toast({
          message: "You're signed out. Sign in again to continue.",
          tone: "error",
          actionLabel: "Sign in",
          onAction: () => leaveForSignIn(),
        });
        return;
      }
      toast({ message: describeLoadError(err, fallback), tone: "error" });
    },
    [toast]
  );

  const loadOriginalForDisplay = useCallback(
    (target: MediaIndexEntry, quiet: boolean) => {
      if (isVideoItem(target) || !canDisplayOriginal(target)) return;
      const store = getStore();
      const cached = store.peek(target.id);
      if (cached) {
        setOriginal({ id: target.id, status: "ready", url: cached.url, progress: 1 });
        return;
      }
      setOriginal((current) =>
        current?.id === target.id && current.status === "loading"
          ? current
          : { id: target.id, status: "loading", progress: null }
      );
      store
        .load(target, (progress) =>
          setOriginal((current) =>
            current?.id === target.id && current.status === "loading" ? { ...current, progress } : current
          )
        )
        .then((entry) =>
          setOriginal((current) =>
            current?.id === target.id ? { id: target.id, status: "ready", url: entry.url, progress: 1 } : current
          )
        )
        .catch((err: unknown) => {
          if (!aliveRef.current) return;
          setOriginal((current) =>
            current?.id === target.id
              ? { id: target.id, status: "error", progress: null, error: describeLoadError(err) }
              : current
          );
          if (!quiet) notifyError(err, "Couldn't load the original. Try again.");
        });
    },
    [getStore, notifyError]
  );

  const loadForVideo = useCallback(
    (entry: MediaIndexEntry, onProgress: ProgressListener): Promise<OriginalEntry> => getStore().load(entry, onProgress),
    [getStore]
  );
  const releaseOriginal = useCallback((id: string) => storeRef.current?.release(id), []);

  // ---- which item is showing ------------------------------------------------

  const currentIdRef = useRef<string | null>(item?.id ?? null);
  const prevPropsRef = useRef({ items, index });

  // Keep showing the same item when the list changes underneath (sync, prepends,
  // removals), unless the parent moved the index itself.
  useLayoutEffect(() => {
    const prev = prevPropsRef.current;
    prevPropsRef.current = { items, index };
    if (closingRef.current) return;
    if (items.length === 0) {
      closeNow();
      return;
    }
    if (prev.items !== items && prev.index === index) {
      const id = currentIdRef.current;
      const found = id ? items.findIndex((entry) => entry.id === id) : -1;
      if (found !== -1 && found !== index) {
        latest.current.onIndexChange(found);
        return;
      }
    }
    if (index !== safeIndex) {
      latest.current.onIndexChange(safeIndex);
      return;
    }
    currentIdRef.current = items[safeIndex]?.id ?? null;
  }, [items, index, safeIndex, closeNow]);

  const isVideo = item ? isVideoItem(item) : false;
  const hasThumb = Boolean(item?.thumb);
  const currentOriginal = original && item && original.id === item.id ? original : null;
  const canZoom = Boolean(item) && !isVideo && (hasThumb || currentOriginal?.status === "ready");
  const currentBox = item ? boxFor(item) : { w: 0, h: 0 };
  const gestureContext = useRef({ canZoom, box: currentBox, stage });
  gestureContext.current = { canZoom, box: currentBox, stage };

  const gestures = useViewerGestures(stageRef, {
    getContext: () => {
      const g = gestureContext.current;
      const at = indexRef.current;
      return {
        width: g.stage.w,
        height: g.stage.h,
        box: g.box,
        canZoom: g.canZoom,
        hasPrev: at > 0,
        hasNext: at < itemsRef.current.length - 1,
        enabled: !blockedRef.current && !enteringRef.current,
      };
    },
    onTap: () => setChromeVisible((visible) => !visible),
    onZoomIn: () => {
      const current = itemsRef.current[indexRef.current];
      if (current?.thumb) loadOriginalForDisplay(current, false);
    },
    onZoomedChange: setZoomed,
    onNavigate: (direction) => {
      const next = indexRef.current + direction;
      const target = itemsRef.current[next];
      if (!target) return;
      currentIdRef.current = target.id;
      latest.current.onIndexChange(next);
    },
    onDismiss: (at) => void closeAnimated(at),
    onSwipeUp: () => setInfoOpen(true),
    onDismissProgress: (progress) => {
      const el = chromeRef.current;
      if (el) el.style.opacity = progress === 0 ? "" : String(Math.max(0, 1 - progress * 2.5));
    },
  });

  gesturesRef.current = gestures;

  const setBackdrop = useCallback(
    (el: HTMLDivElement | null) => {
      backdropRef.current = el;
      gestures.setBackdropEl(el);
    },
    [gestures]
  );

  // Open: the tile's thumbnail zooms to the fitted box, then the real slide takes over.
  // No tile: scale in. Reduced motion: crossfade.
  useLayoutEffect(() => {
    const entry = itemsRef.current[indexRef.current];
    const root = rootRef.current;
    const host = flipHostRef.current;
    const stageEl = stageRef.current;
    const backdrop = backdropRef.current;
    if (!entry || !root || !host || !stageEl || !backdrop) return;
    const animate = typeof root.animate === "function";
    if (prefersReducedMotion()) {
      if (animate) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
      return;
    }
    const rect = tileRect(entry.id);
    const tile = rect ? tileImage(entry.id) : null;
    const bounds = stageEl.getBoundingClientRect();
    if (!rect || !tile || !animate || bounds.width <= 0 || bounds.height <= 0) {
      setEnteringId(entry.id);
      if (animate) backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      return;
    }
    const measured = tile.width / tile.height;
    const stated = entry.width && entry.height ? entry.width / entry.height : null;
    const aspect = stated && Math.abs(measured - stated) / stated <= 0.03 ? stated : measured;
    if (aspect !== stated) handleAspect(entry.id, aspect);
    const size = { w: bounds.width, h: bounds.height };
    const box = fitBox(aspect, size.w, size.h);
    enteringRef.current = true;
    stageEl.style.opacity = "0";
    restoreTileRef.current = hideTile(entry.id);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: SPRING });
    chromeRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 240,
      delay: OPEN_MS * 0.5,
      easing: "ease-out",
      fill: "backwards",
    });
    const run = playFlip({
      host,
      layers: [{ src: tile.src }],
      aspect,
      from: coverState(toRect(rect), aspect),
      to: containState(boxRect(box, size)),
      duration: OPEN_MS,
      baseWidth: box.w,
    });
    openFlipRef.current = run;
    void run.finished.then(async () => {
      if (openFlipRef.current !== run) return;
      restoreTileRef.current();
      restoreTileRef.current = () => {};
      stageEl.style.opacity = "";
      // Hand off under the overlay once the slide has a picture, then drop the overlay.
      await slideReady(stageEl, 300);
      await nextFrame();
      if (openFlipRef.current !== run) return;
      run.remove();
      openFlipRef.current = null;
      enteringRef.current = false;
    });
    return () => {
      run.remove();
      restoreTileRef.current();
      restoreTileRef.current = () => {};
      if (openFlipRef.current === run) openFlipRef.current = null;
      enteringRef.current = false;
      stageEl.style.opacity = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Never leave a tile hidden or an overlay (and its image) behind.
  useEffect(
    () => () => {
      restoreTileRef.current();
      restoreTileRef.current = () => {};
      closeFlipRef.current?.remove();
    },
    []
  );

  const currentId = item?.id ?? null;
  const shownIdRef = useRef(currentId);
  useLayoutEffect(() => {
    if (shownIdRef.current === currentId) return;
    shownIdRef.current = currentId;
    gestures.itemChanged();
    setZoomed(false);
    setVideoPlaying(false);
    setLeavingId(null);
    setInfoRecord(null);
    const cached = currentId ? storeRef.current?.peek(currentId) : null;
    setOriginal(cached && currentId ? { id: currentId, status: "ready", url: cached.url, progress: 1 } : null);
  }, [currentId, gestures]);

  // Photos always end up at original quality: the thumbnail and 1600px preview
  // show instantly and the original replaces them as soon as it has downloaded.
  useEffect(() => {
    if (!item || !autoLoadsOriginal(item)) return;
    const target = item;
    if (!target.thumb) {
      loadOriginalForDisplay(target, true);
      return;
    }
    const timer = window.setTimeout(() => loadOriginalForDisplay(target, true), ORIGINAL_DWELL_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Late downloads of photos already swiped past must never evict what's on
  // screen or the next photo's prefetched original.
  useEffect(() => {
    const next = itemsRef.current[indexRef.current + 1];
    const keep = [currentId, next && autoLoadsOriginal(next) ? next.id : null];
    getStore().pin(keep.filter((id): id is string => Boolean(id)));
  }, [currentId, getStore]);

  // Then the next photo's original downloads in the background, so swiping
  // forward lands on full quality straight away (not when saving data).
  const currentOriginalReady = currentOriginal?.status === "ready";
  useEffect(() => {
    if (!currentOriginalReady || savingData()) return;
    const next = itemsRef.current[indexRef.current + 1];
    if (!next || !autoLoadsOriginal(next)) return;
    getStore()
      .load(next)
      .catch(() => {
        // Loads again (with progress) if the user swipes to it.
      });
  }, [currentOriginalReady, currentId, getStore]);

  useEffect(() => {
    if (!enteringId) return;
    const timer = window.setTimeout(() => setEnteringId(null), 400);
    return () => window.clearTimeout(timer);
  }, [enteringId]);

  useEffect(() => {
    gestures.resetZoom(false);
  }, [stage.w, stage.h, gestures]);

  useEffect(() => {
    setNative(hasNativeBackup());
  }, []);

  useEffect(() => {
    setShareable(item ? hasNativeBackup() || canShareFiles(item) : false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.mimeType]);

  // Warm the cache for the photos two steps away (the direct neighbours are already rendered).
  useEffect(() => {
    for (const offset of [2, -2]) {
      const entry = items[safeIndex + offset];
      if (entry?.thumb) preloadPreviewThumb(repoKey, entry.id);
    }
  }, [items, safeIndex, repoKey]);

  useEffect(() => {
    if (!infoOpen || !item) return;
    const store = getStore();
    const cached = store.cachedRecord(item.id);
    if (cached) {
      setInfoRecord(cached);
      return;
    }
    let cancelled = false;
    setInfoLoading(true);
    store
      .record(item.id)
      .then((record) => {
        if (!cancelled) setInfoRecord(record);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoOpen, item?.id, getStore]);

  // The viewer is always black: light system-bar icons, hidden bars in immersive mode.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.systemBars = "dark";
    return () => {
      delete root.dataset.systemBars;
      delete root.dataset.immersive;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!chromeVisible && !closing && !editing && !infoOpen) root.dataset.immersive = "true";
    else delete root.dataset.immersive;
  }, [chromeVisible, closing, editing, infoOpen]);

  useEffect(() => {
    if (!videoPlaying || !chromeVisible || blocked) return;
    const timer = window.setTimeout(() => setChromeVisible(false), AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [videoPlaying, chromeVisible, blocked, activity]);

  const bumpActivity = useCallback(() => setActivity((n) => n + 1), []);

  // ---- actions --------------------------------------------------------------

  const toggleFavorite = useCallback(() => {
    const current = itemsRef.current[indexRef.current];
    if (!current) return;
    selectHaptic();
    if (!current.favorite) setFavoritePulse((n) => n + 1);
    latest.current.onFavoriteChange(current.id, !current.favorite);
  }, []);

  const runTransfer = useCallback(async (label: string, task: (progress: ProgressListener) => Promise<void>) => {
    if (transferBusyRef.current) return;
    transferBusyRef.current = true;
    setTransfer({ label, progress: null });
    try {
      await task((progress) => {
        if (aliveRef.current) setTransfer((t) => (t ? { ...t, progress } : t));
      });
    } finally {
      transferBusyRef.current = false;
      if (aliveRef.current) setTransfer(null);
    }
  }, []);

  const download = useCallback(
    (target: MediaIndexEntry) => {
      if (hasNativeBackup()) {
        void runTransfer("Saving to your phone", async (progress) => {
          try {
            await nativeTransfer("save", target.id, progress);
            toast({ message: "Saved to your phone", tone: "success" });
          } catch (err) {
            if (!isShareCancel(err)) notifyError(err, "Couldn't save to your phone. Try again.");
          }
        });
        return;
      }
      const cached = storeRef.current?.peek(target.id);
      if (cached) {
        triggerDownload(cached.url, target.filename);
        return;
      }
      void runTransfer("Preparing download", async (progress) => {
        try {
          const entry = await getStore().load(target, progress);
          triggerDownload(entry.url, target.filename);
        } catch (err) {
          notifyError(err, "Couldn't download this. Try again.");
        }
      });
    },
    [getStore, notifyError, runTransfer, toast]
  );

  const share = useCallback(
    (target: MediaIndexEntry) => {
      if (hasNativeBackup()) {
        void runTransfer("Preparing to share", async (progress) => {
          try {
            await nativeTransfer("share", target.id, progress);
          } catch (err) {
            if (!isShareCancel(err)) notifyError(err, "Couldn't share this. Try again.");
          }
        });
        return;
      }
      const startedAt = Date.now();
      let file: File | null = null;
      void runTransfer("Preparing to share", async (progress) => {
        try {
          const entry = await getStore().load(target, progress);
          file = new File([entry.blob], target.filename, { type: target.mimeType });
        } catch (err) {
          notifyError(err, "Couldn't get this ready to share. Try again.");
        }
      }).then(async () => {
        const ready = file;
        if (!ready || !aliveRef.current) return;
        const send = () => navigator.share({ files: [ready] });
        const offer = () =>
          toast({
            message: "Ready to share",
            actionLabel: "Share",
            durationMs: 10000,
            onAction: () => {
              send().catch((err: unknown) => {
                if (!isShareCancel(err)) toast({ message: "Couldn't share this.", tone: "error" });
              });
            },
          });
        if (Date.now() - startedAt > SHARE_GESTURE_MS) {
          offer();
          return;
        }
        try {
          await send();
        } catch (err) {
          if (isShareCancel(err)) return;
          if (err instanceof DOMException && err.name === "NotAllowedError") offer();
          else notifyError(err, "Couldn't share this. Try again.");
        }
      });
    },
    [getStore, notifyError, runTransfer, toast]
  );

  /** Animates the current item out, then hands the change to the parent and follows the neighbour by id. */
  const removeCurrent = useCallback(
    (target: MediaIndexEntry, commit: () => void) => {
      const list = itemsRef.current;
      const at = list.findIndex((entry) => entry.id === target.id);
      if (at === -1) {
        commit();
        return;
      }
      const follow = list[at + 1] ?? list[at - 1] ?? null;
      setLeavingId(target.id);
      window.setTimeout(() => {
        if (!aliveRef.current) return;
        currentIdRef.current = follow?.id ?? null;
        if (!follow) {
          closingRef.current = true;
          setClosing(true);
          commit();
          callClose();
          return;
        }
        setEnteringId(follow.id);
        commit();
        // The parent kept the item (failed or undone): bring it back into view.
        window.setTimeout(() => {
          if (!aliveRef.current || shownIdRef.current !== target.id) return;
          currentIdRef.current = target.id;
          setEnteringId(target.id);
          setLeavingId(null);
        }, 1200);
      }, LEAVE_MS);
    },
    [callClose]
  );

  const requestDelete = useCallback(async () => {
    const target = itemsRef.current[indexRef.current];
    if (!target || blockedRef.current) return;
    setConfirming(true);
    const confirmed = await confirm({
      title: isVideoItem(target) ? "Move this video to Trash?" : "Move this photo to Trash?",
      message: "You can restore it from Trash for 30 days. After that it's deleted for good.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!aliveRef.current) return;
    setConfirming(false);
    if (!confirmed || closingRef.current) return;
    removeCurrent(target, () => latest.current.onDelete([target.id]));
  }, [confirm, removeCurrent]);

  const restoreCurrent = useCallback(() => {
    const target = itemsRef.current[indexRef.current];
    const handler = latest.current.trash?.onRestore;
    if (!target || !handler || blockedRef.current) return;
    removeCurrent(target, () => handler(target.id));
  }, [removeCurrent]);

  const requestDeleteForever = useCallback(async () => {
    const target = itemsRef.current[indexRef.current];
    if (!target || !latest.current.trash || blockedRef.current) return;
    setConfirming(true);
    const confirmed = await confirm({
      title: isVideoItem(target) ? "Delete this video forever?" : "Delete this photo forever?",
      message: "It's removed from your GitHub repo right away. This can't be undone.",
      confirmLabel: "Delete forever",
      destructive: true,
    });
    if (!aliveRef.current) return;
    setConfirming(false);
    const handler = latest.current.trash?.onDeleteForever;
    if (!confirmed || !handler || closingRef.current) return;
    removeCurrent(target, () => handler(target.id));
  }, [confirm, removeCurrent]);

  const removeFromAlbum = useCallback(() => {
    const target = itemsRef.current[indexRef.current];
    const handler = latest.current.onRemoveFromAlbum;
    if (!target || !handler || blockedRef.current) return;
    removeCurrent(target, () => handler(target.id));
  }, [removeCurrent]);

  const retryCurrentOriginal = useCallback(() => {
    const current = itemsRef.current[indexRef.current];
    if (current) loadOriginalForDisplay(current, true);
  }, [loadOriginalForDisplay]);

  const downloadCurrent = useCallback(() => {
    const current = itemsRef.current[indexRef.current];
    if (current) download(current);
  }, [download]);

  // Arrow keys and zoom shortcuts (Escape is handled by the escape layer).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (blockedRef.current || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (target && target !== document.body && !rootRef.current?.contains(target)) return;
      switch (e.key) {
        case "ArrowLeft":
          gestures.navigate(-1);
          break;
        case "ArrowRight":
          gestures.navigate(1);
          break;
        case "+":
        case "=":
          gestures.zoomBy(1.6);
          break;
        case "-":
        case "_":
          gestures.zoomBy(1 / 1.6);
          break;
        case "0":
          gestures.resetZoom();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [gestures]);

  if (!item) return null;

  // ---- render ---------------------------------------------------------------

  const slides = [-1, 0, 1].flatMap((offset) => {
    const entry = items[safeIndex + offset];
    return entry ? [{ offset, entry }] : [];
  });
  const baseTitle = viewerTitle(item.takenAt ?? item.createdAt);
  const daysLeft = trash ? daysLeftInTrash(item) : 0;
  const title =
    trash && baseTitle
      ? { ...baseTitle, time: `${baseTitle.time} · ${daysLeft > 0 ? `${daysLeftLabel(daysLeft)} left` : "Deleted today"}` }
      : baseTitle;
  const downloadLabel = native ? "Save" : "Download";
  const chromeShown = chromeVisible && !closing;
  const previewOnly = !isVideo && hasThumb && !canDisplayOriginal(item);

  let originalChip: OriginalChipState | null = null;
  if (!isVideo && hasThumb) {
    if (previewOnly) originalChip = { kind: "preview-only" };
    else if (currentOriginal?.status === "ready") originalChip = { kind: "ready" };
    else if (currentOriginal?.status === "loading") originalChip = { kind: "loading", progress: currentOriginal.progress };
    else originalChip = { kind: "idle" };
  }

  const explainPreview = () =>
    toast({
      message: `${isHeic(item) ? "HEIC photos" : "Photos in this format"} can't be shown at full quality in a browser. Download it to see the original.`,
      durationMs: 6000,
    });

  const favorite = Boolean(item.favorite);
  const actions: ViewerAction[] = [];
  const menu: ViewerAction[] = [];
  const details: ViewerAction = { key: "info", label: "Details", icon: <InfoIcon />, onClick: () => setInfoOpen(true) };
  if (trash) {
    actions.push({ key: "restore", label: "Restore", icon: <RestoreIcon size={20} />, onClick: restoreCurrent, labelled: true });
    actions.push(details);
    actions.push({
      key: "delete-forever",
      label: "Delete forever",
      icon: <DeleteForeverIcon size={20} />,
      onClick: () => void requestDeleteForever(),
      labelled: true,
    });
  } else {
    if (shareable) {
      actions.push({ key: "share", label: "Share", icon: <ShareIcon />, onClick: () => share(item), disabled: transfer !== null });
    }
    actions.push({
      key: "favorite",
      label: favorite ? "Remove from favorites" : "Add to favorites",
      pressed: favorite,
      onClick: toggleFavorite,
      icon: (
        <span className="relative flex">
          <span key={favoritePulse} className={`flex ${favoritePulse > 0 && favorite ? "lv-heart-pop" : ""}`}>
            <HeartIcon filled={favorite} className={favorite ? "lv-heart-on" : undefined} />
          </span>
          {favoritePulse > 0 && favorite && <span key={`burst-${favoritePulse}`} className="lv-heart-burst" />}
        </span>
      ),
    });
    if (canEdit(item)) {
      actions.push({ key: "edit", label: "Edit", icon: <EditIcon />, onClick: () => setEditing(true) });
    }
    actions.push(details);
    actions.push({ key: "delete", label: "Delete", icon: <TrashIcon />, onClick: () => void requestDelete() });
    menu.push({ key: "album", label: "Add to album", icon: <AlbumAddIcon size={20} />, onClick: () => onAddToAlbum([item.id]) });
    menu.push({
      key: "download",
      label: downloadLabel,
      icon: <DownloadIcon size={20} />,
      onClick: () => download(item),
      disabled: transfer !== null,
    });
    if (onRemoveFromAlbum) {
      menu.push({ key: "remove-from-album", label: "Remove from album", icon: <AlbumRemoveIcon size={20} />, onClick: removeFromAlbum });
    }
  }

  const status: { label: string; progress?: number | null } | null = transfer
    ? { label: transfer.label, progress: transfer.progress }
    : zoomed && previewOnly
      ? { label: "Showing a preview. Download to see the original." }
      : null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={item.filename}
      tabIndex={-1}
      // Portaled children (editor, details sheet) bubble React events here too: only handle our own DOM.
      onKeyDown={(e) => {
        const root = rootRef.current;
        if (e.key === "Tab" && root && root.contains(e.target as Node)) trapTab(e, root);
      }}
      onFocus={(e) => {
        const root = rootRef.current;
        if (!chromeVisible && root && e.target !== root && root.contains(e.target as Node)) setChromeVisible(true);
      }}
      className={`fixed inset-0 z-viewer touch-none select-none overflow-hidden text-white outline-none ${
        closing ? "pointer-events-none" : ""
      }`}
    >
      <div ref={setBackdrop} className="absolute inset-0 bg-black">
        <Ambient repoKey={repoKey} mediaId={item.id} enabled={hasThumb} />
      </div>

      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        <div ref={gestures.setTrackEl} className="absolute inset-0">
          {slides.map(({ offset, entry }) => {
            const current = offset === 0;
            const box = boxFor(entry);
            const motion = !current || closing
              ? ""
              : leavingId === entry.id
                  ? "animate-viewer-out"
                  : enteringId === entry.id
                    ? "animate-viewer-in"
                    : "";
            return (
              <div
                key={entry.id}
                aria-hidden={current ? undefined : true}
                data-viewer-current={current ? "" : undefined}
                className="absolute inset-0"
                style={
                  current ? undefined : { transform: `translate3d(calc(${offset * 100}% + ${offset * SLIDE_GAP}px), 0, 0)` }
                }
              >
                <div ref={current ? gestures.setDismissEl : undefined} className="absolute inset-0">
                  <div className={`absolute inset-0 ${motion}`}>
                    <div ref={current ? gestures.setZoomEl : undefined} className="absolute inset-0 origin-center">
                      {isVideoItem(entry) ? (
                        <VideoSlide
                          item={entry}
                          repoKey={repoKey}
                          box={box}
                          active={current && !closing}
                          controlsVisible={current && chromeShown}
                          loadOriginal={loadForVideo}
                          releaseOriginal={releaseOriginal}
                          onAspect={handleAspect}
                          onPlayingChange={setVideoPlaying}
                          onActivity={bumpActivity}
                          onDownload={downloadCurrent}
                          downloadLabel={downloadLabel}
                        />
                      ) : (
                        <ImageSlide
                          item={entry}
                          repoKey={repoKey}
                          box={box}
                          active={current}
                          original={current ? currentOriginal : null}
                          onAspect={handleAspect}
                          onRetryOriginal={retryCurrentOriginal}
                          onDownload={downloadCurrent}
                          downloadLabel={downloadLabel}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={flipHostRef} className="lv-flip-host" />

      <div
        ref={chromeRef}
        className={`pointer-events-none absolute inset-0 transition-opacity duration-250 ease-out ${
          chromeShown ? "opacity-100" : "opacity-0"
        }`}
      >
        <TopBar
          visible={chromeShown}
          title={title}
          edited={Boolean(item.editedFrom)}
          originalChip={originalChip}
          onBack={requestClose}
          onOriginal={previewOnly ? explainPreview : () => loadOriginalForDisplay(item, false)}
          menu={menu}
        />
        <SideArrows
          visible={chromeShown}
          hasPrev={safeIndex > 0}
          hasNext={safeIndex < items.length - 1}
          onPrev={() => gestures.navigate(-1)}
          onNext={() => gestures.navigate(1)}
        />
        <BottomBar visible={chromeShown} actions={actions} />
      </div>

      {status && !closing && <StatusPill key={status.label} label={status.label} progress={status.progress} />}

      <InfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        item={item}
        record={infoRecord}
        loading={infoLoading}
        repoKey={repoKey}
      />

      {editing && (
        <PhotoEditor
          media={item}
          onClose={() => setEditing(false)}
          onSaved={(newMediaId) => {
            setEditing(false);
            latest.current.onEdited?.(newMediaId);
          }}
        />
      )}
    </div>
  );
}
