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
import ImageSlide from "./viewer/ImageSlide";
import InfoSheet from "./viewer/InfoSheet";
import VideoSlide from "./viewer/VideoSlide";
import { BottomBar, SideArrows, StatusPill, TopBar, type OriginalChipState, type ViewerAction } from "./viewer/ViewerChrome";
import { canDisplayOriginal, isHeic, isVideoItem, viewerTitle } from "./viewer/format";
import { fitBox, type Size } from "./viewer/geometry";
import {
  AlbumAddIcon,
  DeleteForeverIcon,
  DownloadIcon,
  EditIcon,
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
import { preloadPreviewThumb } from "./viewer/useCachedThumb";
import { SLIDE_GAP, useViewerGestures } from "./viewer/useViewerGestures";

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

// Bigger originals (100 MP+ panoramas) load when zooming, so a phone doesn't
// decode gigabytes of pixels just to show them at screen size. Items without
// thumbnails have nothing else to show, so theirs always load.
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

const CLOSE_MS = 200;
const LEAVE_MS = 220;
const AUTO_HIDE_MS = 3000;
// Browsers only open the share sheet shortly after a tap.
const SHARE_GESTURE_MS = 4000;

/**
 * Full-screen viewer. Swipe sideways to move between items, down to close and up
 * for details; pinch, double-tap or scroll to zoom; tap to hide the toolbars.
 * The 320px thumbnail shows instantly, the 1600px preview fades in over it, and
 * the original downloads right away and replaces both (formats a browser can't
 * draw, like HEIC, stay on the preview). The parent owns data changes; this only
 * calls back and moves to a neighbour after a removal.
 */
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
  const [enteringId, setEnteringId] = useState<string | null>(() => items[safeIndex]?.id ?? null);
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

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    window.setTimeout(callClose, CLOSE_MS);
  }, [callClose]);

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
        enabled: !blockedRef.current,
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
    onDismiss: closeNow,
    onSwipeUp: () => setInfoOpen(true),
    onDismissProgress: (progress) => {
      const el = chromeRef.current;
      if (el) el.style.opacity = progress === 0 ? "" : String(Math.max(0, 1 - progress * 2.5));
    },
  });

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

  /**
   * Animates the current item out, then hands the change to the parent. The
   * neighbour is followed by id once the parent's list drops the item, whether
   * or not the parent also moves the index itself.
   */
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

  const actions: ViewerAction[] = [];
  if (trash) {
    actions.push({ key: "restore", label: "Restore", icon: <RestoreIcon />, onClick: restoreCurrent });
    actions.push({
      key: "delete-forever",
      label: "Delete forever",
      icon: <DeleteForeverIcon />,
      onClick: () => void requestDeleteForever(),
    });
  } else if (shareable) {
    actions.push({ key: "share", label: "Share", icon: <ShareIcon />, onClick: () => share(item), disabled: transfer !== null });
  }
  if (!trash) {
    if (canEdit(item)) {
      actions.push({ key: "edit", label: "Edit", icon: <EditIcon />, onClick: () => setEditing(true) });
    }
    actions.push({ key: "album", label: "Add to album", icon: <AlbumAddIcon />, onClick: () => onAddToAlbum([item.id]) });
    actions.push({
      key: "download",
      label: downloadLabel,
      icon: <DownloadIcon />,
      onClick: () => download(item),
      disabled: transfer !== null,
    });
    actions.push({ key: "delete", label: "Delete", icon: <TrashIcon />, onClick: () => void requestDelete() });
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
      <div
        ref={gestures.setBackdropEl}
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${closing ? "opacity-0" : "animate-fade-in"}`}
      />

      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        <div ref={gestures.setTrackEl} className="absolute inset-0">
          {slides.map(({ offset, entry }) => {
            const current = offset === 0;
            const box = boxFor(entry);
            const motion = !current
              ? ""
              : closing
                ? "scale-95 opacity-0 transition duration-200 ease-in"
                : leavingId === entry.id
                  ? "animate-viewer-out"
                  : enteringId === entry.id
                    ? "animate-viewer-in"
                    : "";
            return (
              <div
                key={entry.id}
                aria-hidden={current ? undefined : true}
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
          favorite={Boolean(item.favorite)}
          favoritePulse={favoritePulse}
          originalChip={originalChip}
          onBack={requestClose}
          onFavorite={trash ? undefined : toggleFavorite}
          onInfo={() => setInfoOpen(true)}
          onOriginal={previewOnly ? explainPreview : () => loadOriginalForDisplay(item, false)}
          onRemoveFromAlbum={onRemoveFromAlbum && !trash ? removeFromAlbum : undefined}
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
