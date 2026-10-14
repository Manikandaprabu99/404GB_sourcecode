"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { MediaIndexEntry } from "@/lib/media";
import type { FaceBox } from "@/lib/faces/people";
import { useIsomorphicLayoutEffect } from "@/lib/library/hooks";
import { getGridWidth, setGridWidth } from "@/lib/library/viewState";
import type { ZoomLevel } from "@/lib/library/zoom";
import { select as hapticSelect, tick as hapticTick } from "@/lib/ui/haptics";
import { registerGridScroller } from "@/lib/ui/sharedElement";
import FaceAvatar from "@/app/components/search/FaceAvatar";
import { CheckIcon } from "@/app/components/library/icons";
import { itemCount, type DateGroup } from "./dateGroups";
import GalleryThumb from "./GalleryThumb";
import { offsetWithin } from "./layoutMath";
import TimelineScrubber, { type TimelineMark } from "./TimelineScrubber";

export function columnsForWidth(width: number): number {
  if (width >= 1200) return 6;
  if (width >= 900) return 5;
  if (width >= 640) return 4;
  return 3;
}

/** docs/DESIGN.md › Shape: 2px on phones, 3px on tablets, 4px on desktop widths. */
export function gapForWidth(width: number): number {
  return width >= 960 ? 4 : width >= 600 ? 3 : 2;
}

/** Denser grids for the month and year views, like zooming out in Google Photos. */
const DENSITY: Record<ZoomLevel, { columns: (width: number) => number; gap: (width: number) => number; header: number }> = {
  day: { columns: columnsForWidth, gap: gapForWidth, header: 58 },
  month: {
    columns: (w) => (w >= 1200 ? 10 : w >= 900 ? 8 : w >= 640 ? 7 : 5),
    gap: (w) => (w >= 640 ? 3 : 2),
    header: 66,
  },
  year: {
    columns: (w) => (w >= 1200 ? 15 : w >= 900 ? 12 : w >= 640 ? 10 : 7),
    gap: (w) => (w >= 640 ? 2 : 1),
    header: 76,
  },
};

// Day: headline over a "24 photos · 3 videos" footnote; Month: title role; Year: large title.
const HEADER_TITLE: Record<ZoomLevel, string> = {
  day: "text-[17px] font-semibold leading-[22px] tracking-[-0.01em]",
  month: "text-[22px] font-[650] leading-[28px] tracking-[-0.015em]",
  year: "text-[32px] font-bold leading-[38px] tracking-[-0.025em] tabular-nums",
};

/** A person in a day's photos, for the header's avatar stack. */
export interface GroupPerson {
  id: string;
  cover: { mediaId: string; box: FaceBox } | null;
  entry?: MediaIndexEntry;
}

export const GROUP_HEADER_HEIGHT = DENSITY.day.header;

/** Height of a pinned date header in a view (the scrubber's track starts under it). */
export function groupHeaderHeight(zoom: ZoomLevel): number {
  return DENSITY[zoom].header;
}
const GROUP_GAP = 10;
/** Pinch distance ratio that switches the view (once per gesture). */
const PINCH_OUT_RATIO = 1.3;
const PINCH_IN_RATIO = 0.77;
/** Accumulated Ctrl+wheel delta (trackpad pinch or Ctrl+scroll) per view step. */
const WHEEL_STEP = 90;
const WHEEL_COOLDOWN_MS = 350;
const OVERSCAN_PX = 900;
const WINDOW_STEP_PX = 240;
const LONG_PRESS_MS = 420;
const LONG_PRESS_SLOP_PX = 10;
/** Drag-select scrolls when the finger is this close to the top or bottom of the grid's view. */
const EDGE_ZONE_PX = 72;
const EDGE_MAX_SPEED = 22;
/** Room the floating nav and selection bar take at the bottom of the scroller. */
const BOTTOM_CHROME_PX = 150;
/** Pinch: how far the live scale follows the fingers before the view switches. */
const PINCH_LIVE_MIN = 0.8;
const PINCH_LIVE_MAX = 1.22;
/** First paint: rows fade in this far apart (at most INTRO_ROWS of them). */
const INTRO_STAGGER_MS = 32;
const INTRO_ROWS = 10;

// Once per page load (see the intro effect in VirtualGrid).
let gridIntroPlayed = false;

interface GroupLayout {
  group: DateGroup;
  top: number;
  height: number;
  rows: number;
}

interface Metrics {
  columns: number;
  gap: number;
  header: number;
  rowHeight: number;
  /** Integer left edge and width per column, so tiles fill the row exactly. */
  lefts: number[];
  widths: number[];
}

function computeMetrics(width: number, zoom: ZoomLevel): Metrics {
  const density = DENSITY[zoom];
  const columns = density.columns(width);
  const gap = density.gap(width);
  const tile = (width - gap * (columns - 1)) / columns;
  const lefts: number[] = [];
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    const left = Math.round(c * (tile + gap));
    const right = Math.round(c * (tile + gap) + tile);
    lefts.push(left);
    widths.push(Math.max(1, right - left));
  }
  return { columns, gap, header: density.header, rowHeight: Math.max(1, Math.round(tile)), lefts, widths };
}

function layoutGroups(groups: DateGroup[], metrics: Metrics) {
  let y = 0;
  const layouts: GroupLayout[] = groups.map((group, index) => {
    const rows = Math.ceil(group.items.length / metrics.columns);
    const height =
      metrics.header +
      rows * metrics.rowHeight +
      Math.max(0, rows - 1) * metrics.gap +
      (index < groups.length - 1 ? GROUP_GAP : 0);
    const layout = { group, top: y, height, rows };
    y += height;
    return layout;
  });
  return { layouts, total: y };
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

interface TileProps {
  item: MediaIndexEntry;
  repoKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The year view's small tiles keep only the essentials of the badges. */
  dense: boolean;
  selectMode: boolean;
  selected: boolean;
  /** A short label in the corner, e.g. days left in Trash. */
  badge: string | null;
}

// Tile badges: small text on a dark scrim. No blur or shadow on anything in a tile, which
// would be painted again for every tile on every frame of a scroll.
const TILE_BADGE =
  "pointer-events-none absolute flex h-[18px] items-center gap-1 rounded-[5px] bg-black/55 px-[5px] text-[10.5px] font-semibold leading-none text-white tabular-nums";

/** The favourite mark: a white heart with a thin dark edge, readable on light photos. */
function TileHeart({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className="pointer-events-none absolute bottom-1.5 left-1.5"
    >
      <path
        d="M12 20.3s-7.6-4.6-9.3-9.5C1.5 7.2 3.9 3.7 7.5 3.7c2 0 3.5 1.1 4.5 2.6 1-1.5 2.5-2.6 4.5-2.6 3.6 0 6 3.5 4.8 7.1-1.7 4.9-9.3 9.5-9.3 9.5Z"
        fill="#fff"
        stroke="rgb(0 0 0 / 0.35)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The round 24px selection check (docs/DESIGN.md › SelectCheck): a white ring on photos, a
 * border-strong ring on the background; accent with a white tick when selected. */
export function RoundCheck({ selected, onPhoto = true, size = 24 }: { selected: boolean; onPhoto?: boolean; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 items-center justify-center rounded-full ${
        selected ? "" : onPhoto ? "border-2 border-white/95 bg-black/15" : "border-2 border-border-strong"
      }`}
      style={{ width: size, height: size }}
    >
      {selected && (
        <span className="lp-check-pop absolute inset-0 flex items-center justify-center rounded-full bg-accent text-accent-ink">
          <CheckIcon size={Math.round(size * 0.56)} strokeWidth={3.2} />
        </span>
      )}
    </span>
  );
}

const Tile = memo(function Tile({
  item,
  repoKey,
  x,
  y,
  width,
  height,
  dense,
  selectMode,
  selected,
  badge,
}: TileProps) {
  const isVideo = item.mimeType?.startsWith("video/") ?? false;
  const duration = typeof item.duration === "number" && item.duration > 0 ? formatDuration(item.duration) : null;
  return (
    <button
      type="button"
      data-media-id={item.id}
      aria-label={`${isVideo ? "Video" : "Photo"} ${item.filename}`}
      aria-pressed={selectMode ? selected : undefined}
      className={`lp-tile group absolute left-0 top-0 overflow-hidden rounded-thumb outline-none [-webkit-touch-callout:none] focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
        selected ? "lp-accent-soft" : "bg-surface-2"
      }`}
      style={{ width, height, transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      {/* Picked: the picture shrinks to 0.9 inside an accent ring (gallery.css). */}
      <span className="lp-tile-pic block h-full w-full overflow-hidden rounded-thumb">
        <GalleryThumb
          repoKey={repoKey}
          mediaId={item.id}
          alt=""
          hasThumbnail={Boolean(item.thumb)}
          isVideo={isVideo}
          className="h-full w-full object-cover"
        />
      </span>
      {selectMode && <span className="lp-tile-ring pointer-events-none absolute inset-0 rounded-[10px] border-[2.5px] border-accent" />}

      {isVideo && (
        <span className={`${TILE_BADGE} bottom-1 right-1 ${dense ? "!px-1" : ""}`}>
          <svg viewBox="0 0 10 10" width="7" height="7" aria-hidden="true" fill="currentColor">
            <path d="M2 1.2v7.6a.6.6 0 0 0 .9.5l6-3.8a.6.6 0 0 0 0-1L2.9.7a.6.6 0 0 0-.9.5Z" />
          </svg>
          {!dense && duration}
        </span>
      )}
      {badge && (
        <span data-badge="" className={`${TILE_BADGE} right-1 top-1`}>
          {badge}
        </span>
      )}
      {item.favorite && !selected && <TileHeart size={dense ? 11 : 15} />}

      <span
        data-select-handle=""
        className={`absolute flex transition-opacity duration-160 ease-out ${dense ? "left-1 top-1" : "left-1.5 top-1.5"} ${
          selectMode
            ? "pointer-events-none opacity-100"
            : "pointer-events-none opacity-0 group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:pointer-events-auto"
        }`}
      >
        <RoundCheck selected={selected} size={dense ? 18 : 24} />
      </span>
      <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-120 group-active:bg-black/10" />
    </button>
  );
});

export interface VirtualGridProps {
  groups: DateGroup[];
  /** Day, month or year view: tile density and header style. */
  zoom: ZoomLevel;
  /** Pinch or Ctrl+wheel: +1 = zoom out (denser), -1 = zoom in; false when already at that end. */
  onZoomStep?: (direction: 1 | -1) => boolean | void;
  /** Where to render the timeline scrubber (an overlay outside the scroller). */
  scrubberHost?: HTMLElement | null;
  repoKey: string;
  /** The scrolling element this grid lives in. */
  scrollRef: RefObject<HTMLElement>;
  /** Height of the sticky header above the grid; date headers pin right below it. */
  stickyTop: number;
  /** Scroll offset to restore before the first paint (returning to the screen). */
  initialScrollTop?: number;
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onOpen: (id: string) => void;
  /** `extend` is true for shift-click range selection. */
  onToggleSelect: (id: string, extend: boolean) => void;
  /** Long-press (touch) or the hover check mark (mouse) outside selection mode. */
  onStartSelect: (id: string) => void;
  onToggleGroup?: (groupKey: string) => void;
  /** Drag-select: sets these items' selection (after a long press, as the finger moves). */
  onSetMany?: (ids: readonly string[], selected: boolean) => void;
  /** A corner label per tile (null for none). */
  badgeFor?: (item: MediaIndexEntry) => string | null;
  /** The people in a day's photos, for the Day header's avatar stack (called for mounted
   * headers only; memoise it). */
  groupPeople?: (group: DateGroup) => GroupPerson[];
}

/**
 * Windowed photo grid. Only rows near the viewport are mounted; each date
 * group is an absolutely positioned section whose header uses real CSS
 * `position: sticky`, so the pinned date is moved by the compositor (no
 * scroll-handler jitter) and the next group pushes it away naturally.
 */
export default function VirtualGrid({
  groups,
  zoom,
  onZoomStep,
  scrubberHost,
  repoKey,
  scrollRef,
  stickyTop,
  initialScrollTop,
  selectMode,
  selectedIds,
  onOpen,
  onToggleSelect,
  onStartSelect,
  onToggleGroup,
  onSetMany,
  badgeFor,
  groupPeople,
}: VirtualGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => getGridWidth());
  const [win, setWin] = useState(() => ({
    top: 0,
    bottom: (typeof window === "undefined" ? 900 : window.innerHeight) + OVERSCAN_PX,
  }));
  const restoreRef = useRef(initialScrollTop);
  // Scroll position as of the last scroll event: read after a zoom re-render,
  // before the browser clamps it to the (often shorter) new grid.
  const lastScrollTopRef = useRef(0);
  const prevLayoutRef = useRef<{ zoom: ZoomLevel; layouts: GroupLayout[]; metrics: Metrics } | null>(null);
  const onZoomStepRef = useRef(onZoomStep);
  onZoomStepRef.current = onZoomStep;
  /** Set by a pinch that switched the view: where the fingers were and how far it had scaled. */
  const pinchHandoffRef = useRef<{ clientX: number; clientY: number; scale: number } | null>(null);
  /** Cancels a pending long press (a second finger means a pinch). */
  const cancelPressRef = useRef<() => void>(() => {});

  const metrics = useMemo(() => computeMetrics(width > 0 ? width : 360, zoom), [width, zoom]);
  const { layouts, total } = useMemo(() => layoutGroups(groups, metrics), [groups, metrics]);
  const marks = useMemo<TimelineMark[]>(
    () => layouts.map((layout) => ({ top: layout.top, time: layout.group.time })),
    [layouts]
  );

  const updateWindow = useCallback(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;
    const viewTop = scroller.scrollTop - offsetWithin(grid, scroller);
    const top = Math.floor((viewTop - OVERSCAN_PX) / WINDOW_STEP_PX) * WINDOW_STEP_PX;
    const bottom =
      Math.ceil((viewTop + scroller.clientHeight + OVERSCAN_PX) / WINDOW_STEP_PX) * WINDOW_STEP_PX;
    setWin((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
  }, [scrollRef]);

  useIsomorphicLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const next = grid.clientWidth;
      if (next <= 0) return;
      setGridWidth(next);
      setWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid || width <= 0) return;
    // Restore only once the grid is laid out at its real width (and height).
    if (restoreRef.current !== undefined && Math.abs(grid.clientWidth - width) < 0.5) {
      scroller.scrollTop = restoreRef.current;
      restoreRef.current = undefined;
    }
    updateWindow();
  }, [width, total, updateWindow, scrollRef]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    lastScrollTopRef.current = scroller.scrollTop;
    const onScroll = () => {
      lastScrollTopRef.current = scroller.scrollTop;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateWindow();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, updateWindow]);

  // A new zoom level keeps the photo that was at the top of the screen in place,
  // and plays a short scale animation in the direction of the zoom.
  useIsomorphicLayoutEffect(() => {
    const prev = prevLayoutRef.current;
    prevLayoutRef.current = { zoom, layouts, metrics };
    if (!prev || prev.zoom === zoom) return;
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;
    const gridOffset = offsetWithin(grid, scroller);
    const oldViewTop = lastScrollTopRef.current - gridOffset + stickyTop;

    let targetTop: number | null = null;
    let viewTop = Math.max(0, oldViewTop);
    if (oldViewTop > 0) {
      const old = prev.layouts.find((layout) => layout.top + layout.height > oldViewTop);
      if (old && old.group.items.length > 0) {
        const oldStride = prev.metrics.rowHeight + prev.metrics.gap;
        const row = Math.max(0, Math.floor((oldViewTop - old.top - prev.metrics.header) / oldStride));
        const index = Math.min(old.group.items.length - 1, row * prev.metrics.columns);
        const anchorId = old.group.items[index].id;
        const anchorOffset = old.top + prev.metrics.header + row * oldStride - oldViewTop;
        const stride = metrics.rowHeight + metrics.gap;
        for (const layout of layouts) {
          const at = layout.group.items.findIndex((item) => item.id === anchorId);
          if (at < 0) continue;
          const itemTop = layout.top + metrics.header + Math.floor(at / metrics.columns) * stride;
          viewTop = Math.max(0, itemTop - anchorOffset);
          targetTop = gridOffset + viewTop - stickyTop;
          break;
        }
      }
    }
    if (targetTop !== null) scroller.scrollTop = Math.max(0, targetTop);
    lastScrollTopRef.current = scroller.scrollTop;
    updateWindow();

    // A pinch hands over its focal point and live scale so the new grid settles from there.
    const pinch = pinchHandoffRef.current;
    pinchHandoffRef.current = null;
    grid.style.transform = "";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && typeof grid.animate === "function") {
      const zoomingOut = ["day", "month", "year"].indexOf(zoom) > ["day", "month", "year"].indexOf(prev.zoom);
      let from = zoomingOut ? 1.08 : 0.92;
      if (pinch) {
        const gridRect = grid.getBoundingClientRect();
        const scrollerTop = scroller.getBoundingClientRect().top;
        const focalY = scroller.scrollTop - gridOffset + (pinch.clientY - scrollerTop);
        grid.style.transformOrigin = `${Math.round(pinch.clientX - gridRect.left)}px ${Math.round(focalY)}px`;
        const ratio = (prev.metrics.rowHeight * pinch.scale) / Math.max(1, metrics.rowHeight);
        from = zoomingOut ? Math.min(1.35, Math.max(1.04, ratio)) : Math.max(0.74, Math.min(0.96, ratio));
      } else {
        grid.style.transformOrigin = `50% ${Math.round(viewTop + scroller.clientHeight / 3)}px`;
      }
      const animation = grid.animate(
        [
          { opacity: pinch ? 0.55 : 0.25, transform: `scale(${from})` },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: pinch ? 340 : 280, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
      );
      animation.onfinish = () => updateWindow();
    }
  }, [zoom, layouts, metrics, scrollRef, stickyTop, updateWindow]);

  // The first time a grid paints in this page load, what's in view fades in row by row from the
  // top (docs/DESIGN.md › Motion: first viewport only). Later mounts (tab switches, windowing,
  // another zoom level) appear at once. Opacity only: tiles are positioned with transforms.
  useIsomorphicLayoutEffect(() => {
    if (gridIntroPlayed || width <= 0 || layouts.length === 0) return;
    gridIntroPlayed = true;
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid || typeof grid.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const top = scroller.getBoundingClientRect().top;
    const bottom = top + scroller.clientHeight;
    const step = Math.max(48, metrics.rowHeight);
    for (const el of grid.querySelectorAll<HTMLElement>("[data-media-id], [data-group-header]")) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom <= top || rect.top >= bottom) continue;
      const row = Math.min(INTRO_ROWS - 1, Math.max(0, Math.floor((rect.top - top) / step)));
      el.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 280,
        delay: row * INTRO_STAGGER_MS,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "backwards",
      });
    }
  }, [width, layouts, metrics.rowHeight, scrollRef]);

  // Pinch and Ctrl+wheel switch views. The grid follows the fingers a little (transform from the
  // focal point); past the threshold the view switches once and the zoom effect settles it.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let startDistance = 0;
    let fired = false;
    let wheelDelta = 0;
    let wheelBlockedUntil = 0;
    let liveScale = 1;
    let focal = { x: 0, y: 0 };
    let frame = 0;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const midpoint = (touches: TouchList) => ({
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    });
    const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const applyLive = () => {
      frame = 0;
      const grid = gridRef.current;
      if (!grid || fired) return;
      const rect = grid.getBoundingClientRect();
      grid.style.transformOrigin = `${Math.round(focal.x - rect.left)}px ${Math.round(focal.y - rect.top)}px`;
      grid.style.transform = liveScale === 1 ? "" : `scale(${liveScale})`;
    };
    const settleBack = () => {
      const grid = gridRef.current;
      if (!grid || liveScale === 1) return;
      const from = liveScale;
      liveScale = 1;
      grid.style.transform = "";
      if (!reduce() && typeof grid.animate === "function") {
        grid.animate([{ transform: `scale(${from})` }, { transform: "scale(1)" }], { duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)" });
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        cancelPressRef.current();
        startDistance = distance(e.touches);
        focal = midpoint(e.touches);
        fired = false;
        liveScale = 1;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDistance <= 0 || fired) return;
      const ratio = distance(e.touches) / startDistance;
      focal = midpoint(e.touches);
      if (ratio >= PINCH_OUT_RATIO || ratio <= PINCH_IN_RATIO) {
        fired = true;
        const direction = ratio >= PINCH_OUT_RATIO ? -1 : 1;
        pinchHandoffRef.current = { clientX: focal.x, clientY: focal.y, scale: liveScale };
        const moved = onZoomStepRef.current?.(direction);
        if (moved === false) {
          pinchHandoffRef.current = null;
          settleBack();
        }
        return;
      }
      if (reduce()) return;
      // Follows the fingers with some resistance, within a small range.
      liveScale = Math.min(PINCH_LIVE_MAX, Math.max(PINCH_LIVE_MIN, 1 + (ratio - 1) * 0.6));
      if (!frame) frame = requestAnimationFrame(applyLive);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        if (startDistance > 0 && !fired) settleBack();
        startDistance = 0;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !onZoomStepRef.current) return;
      e.preventDefault(); // otherwise the browser zooms the whole page
      const now = performance.now();
      if (now < wheelBlockedUntil) return;
      wheelDelta += e.deltaY;
      if (Math.abs(wheelDelta) >= WHEEL_STEP) {
        pinchHandoffRef.current = { clientX: e.clientX, clientY: e.clientY, scale: 1 };
        if (onZoomStepRef.current(wheelDelta > 0 ? 1 : -1) === false) pinchHandoffRef.current = null;
        wheelDelta = 0;
        wheelBlockedUntil = now + WHEEL_COOLDOWN_MS;
      }
    };
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: true });
    scroller.addEventListener("touchend", onTouchEnd, { passive: true });
    scroller.addEventListener("touchcancel", onTouchEnd, { passive: true });
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("wheel", onWheel);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef]);

  // Shared-element close: scroll a photo's tile into view and mount it right away.
  const layoutRef = useRef({ layouts, metrics, stickyTop });
  layoutRef.current = { layouts, metrics, stickyTop };
  useEffect(
    () =>
      registerGridScroller((mediaId) => {
        const scroller = scrollRef.current;
        const grid = gridRef.current;
        if (!scroller || !grid) return false;
        const { layouts: current, metrics: m, stickyTop: top } = layoutRef.current;
        const stride = m.rowHeight + m.gap;
        for (const layout of current) {
          const at = layout.group.items.findIndex((item) => item.id === mediaId);
          if (at < 0) continue;
          const y = layout.top + m.header + Math.floor(at / m.columns) * stride;
          const gridOffset = offsetWithin(grid, scroller);
          const viewTop = scroller.scrollTop - gridOffset + top + m.header;
          const viewBottom = scroller.scrollTop - gridOffset + scroller.clientHeight - BOTTOM_CHROME_PX;
          if (y < viewTop || y + m.rowHeight > viewBottom) {
            const room = Math.max(m.rowHeight, viewBottom - viewTop);
            const target = gridOffset + y - top - m.header - (room - m.rowHeight) / 2;
            scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, target));
            lastScrollTopRef.current = scroller.scrollTop;
          }
          try {
            flushSync(() => updateWindow());
          } catch {
            updateWindow();
          }
          return true;
        }
        return false;
      }),
    [scrollRef, updateWindow]
  );

  const visible = useMemo(() => {
    const out: { layout: GroupLayout; rowStart: number; rowEnd: number }[] = [];
    let lo = 0;
    let hi = layouts.length - 1;
    let first = layouts.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (layouts[mid].top + layouts[mid].height > win.top) {
        first = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const stride = metrics.rowHeight + metrics.gap;
    for (let i = first; i < layouts.length; i++) {
      const layout = layouts[i];
      if (layout.top >= win.bottom) break;
      const rowsTop = layout.top + metrics.header;
      const rowStart = Math.max(0, Math.floor((win.top - rowsTop) / stride));
      const rowEnd = Math.min(layout.rows - 1, Math.floor((win.bottom - rowsTop) / stride));
      out.push({ layout, rowStart, rowEnd });
    }
    return out;
  }, [layouts, win, metrics]);

  // Latest callbacks for the delegated handlers below, without re-binding them.
  const handlers = useRef({ onOpen, onToggleSelect, onStartSelect, onToggleGroup, onSetMany, selectMode, selectedIds });
  handlers.current = { onOpen, onToggleSelect, onStartSelect, onToggleGroup, onSetMany, selectMode, selectedIds };

  // Display order of every item, for drag-select ranges.
  const order = useMemo(() => {
    const ids: string[] = [];
    for (const group of groups) for (const item of group.items) ids.push(item.id);
    return { ids, index: new Map(ids.map((id, i) => [id, i])) };
  }, [groups]);
  const orderRef = useRef(order);
  orderRef.current = order;

  const pressRef = useRef<{ id: string; x: number; y: number; timer: number; fired: boolean } | null>(
    null
  );
  /** Drag-select after a long press (docs/DESIGN.md "Photos — new experiences" 5). */
  const dragRef = useRef<{
    pointerId: number;
    anchor: number;
    last: number;
    selecting: boolean;
    /** Selection before the drag: items that leave the range go back to it. */
    before: ReadonlySet<string>;
    x: number;
    y: number;
    frame: number;
  } | null>(null);

  const endDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.frame) cancelAnimationFrame(drag.frame);
    dragRef.current = null;
  }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
    endDrag();
  }, [endDrag]);
  cancelPressRef.current = clearPress;

  useEffect(() => clearPress, [clearPress]);

  /** Selects (or deselects) the range from the anchor to the tile under the finger. */
  const dragTo = useCallback((clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    const el = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-media-id]");
    const at = el?.dataset.mediaId ? orderRef.current.index.get(el.dataset.mediaId) : undefined;
    if (at === undefined || at === drag.last) return;
    const { ids } = orderRef.current;
    const span = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);
    const [oldLo, oldHi] = span(drag.anchor, drag.last);
    const [newLo, newHi] = span(drag.anchor, at);
    const restoreOn: string[] = [];
    const restoreOff: string[] = [];
    for (let i = oldLo; i <= oldHi; i++) {
      if (i >= newLo && i <= newHi) continue;
      (drag.before.has(ids[i]) ? restoreOn : restoreOff).push(ids[i]);
    }
    const entering: string[] = [];
    for (let i = newLo; i <= newHi; i++) if (i < oldLo || i > oldHi) entering.push(ids[i]);
    const set = handlers.current.onSetMany;
    if (set) {
      if (restoreOn.length) set(restoreOn, true);
      if (restoreOff.length) set(restoreOff, false);
      if (entering.length) set(entering, drag.selecting);
    }
    drag.last = at;
    hapticTick();
  }, []);

  // While dragging near the top or bottom of the view, the grid scrolls under the finger.
  const autoScroll = useCallback(() => {
    const drag = dragRef.current;
    const scroller = scrollRef.current;
    if (!drag || !scroller) return;
    drag.frame = 0;
    const rect = scroller.getBoundingClientRect();
    const top = rect.top + layoutRef.current.stickyTop + layoutRef.current.metrics.header;
    const bottom = rect.bottom - BOTTOM_CHROME_PX;
    let speed = 0;
    if (drag.y < top + EDGE_ZONE_PX) speed = -EDGE_MAX_SPEED * Math.min(1, (top + EDGE_ZONE_PX - drag.y) / EDGE_ZONE_PX);
    else if (drag.y > bottom - EDGE_ZONE_PX) speed = EDGE_MAX_SPEED * Math.min(1, (drag.y - (bottom - EDGE_ZONE_PX)) / EDGE_ZONE_PX);
    if (speed === 0) return;
    const before = scroller.scrollTop;
    scroller.scrollTop = before + speed;
    if (scroller.scrollTop !== before) {
      dragTo(drag.x, drag.y);
      drag.frame = requestAnimationFrame(autoScroll);
    }
  }, [scrollRef, dragTo]);

  // A drag after a long press must not scroll: cancel touch moves (React's handler is passive).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const onTouchMove = (e: TouchEvent) => {
      if (dragRef.current && e.cancelable) e.preventDefault();
    };
    grid.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => grid.removeEventListener("touchmove", onTouchMove);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      clearPress();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const tile = (e.target as Element).closest<HTMLElement>("[data-media-id]");
      const id = tile?.dataset.mediaId;
      if (!id) return;
      const pointerId = e.pointerId;
      const press = { id, x: e.clientX, y: e.clientY, timer: 0, fired: false };
      press.timer = window.setTimeout(() => {
        press.fired = true;
        hapticSelect();
        const { selectMode: selecting, onStartSelect: start, onToggleSelect: toggle, selectedIds: current } = handlers.current;
        const wasSelected = selecting && current.has(id);
        if (selecting) toggle(id, false);
        else start(id);
        const anchor = orderRef.current.index.get(id);
        // Deselecting the last item leaves selection mode: nothing to drag then.
        const leaving = wasSelected && current.size <= 1;
        if (anchor !== undefined && handlers.current.onSetMany && !leaving) {
          const before = new Set(selecting ? current : []);
          if (!selecting) before.delete(id);
          dragRef.current = { pointerId, anchor, last: anchor, selecting: !wasSelected, before, x: press.x, y: press.y, frame: 0 };
        }
      }, LONG_PRESS_MS);
      pressRef.current = press;
    },
    [clearPress]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        drag.x = e.clientX;
        drag.y = e.clientY;
        dragTo(e.clientX, e.clientY);
        if (!drag.frame) drag.frame = requestAnimationFrame(autoScroll);
        return;
      }
      const press = pressRef.current;
      if (!press || press.fired) return;
      if (
        Math.abs(e.clientX - press.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(e.clientY - press.y) > LONG_PRESS_SLOP_PX
      ) {
        clearPress();
      }
    },
    [clearPress, dragTo, autoScroll]
  );

  const onPointerEnd = useCallback(() => {
    endDrag();
    // A fired press stays recorded so the click that follows it is swallowed.
    if (pressRef.current && !pressRef.current.fired) clearPress();
  }, [clearPress, endDrag]);

  const onClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (press?.fired) return;
    const target = e.target as Element;
    const { onOpen: open, onToggleSelect: toggle, onStartSelect: start, onToggleGroup: toggleGroup, selectMode: selecting } =
      handlers.current;
    const groupKey = target.closest<HTMLElement>("[data-group-key]")?.dataset.groupKey;
    if (groupKey) {
      toggleGroup?.(groupKey);
      return;
    }
    if (target.closest("[data-group-header]")) return;
    const id = target.closest<HTMLElement>("[data-media-id]")?.dataset.mediaId;
    if (!id) return;
    if (!selecting && target.closest("[data-select-handle]")) start(id);
    else if (selecting) toggle(id, e.shiftKey);
    else open(id);
  }, []);

  const onContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("[data-media-id]")) e.preventDefault();
  }, []);

  return (
    <div
      ref={gridRef}
      id="library-grid"
      className="relative w-full select-none"
      style={{ height: width > 0 ? total : 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {width > 0 &&
        visible.map(({ layout, rowStart, rowEnd }) => {
          const { group } = layout;
          const allSelected =
            selectMode && group.items.length > 0 && group.items.every((item) => selectedIds.has(item.id));
          const tiles: JSX.Element[] = [];
          for (let row = rowStart; row <= rowEnd; row++) {
            const y = metrics.header + row * (metrics.rowHeight + metrics.gap);
            const start = row * metrics.columns;
            const end = Math.min(start + metrics.columns, group.items.length);
            for (let index = start; index < end; index++) {
              const item = group.items[index];
              const column = index - start;
              tiles.push(
                <Tile
                  key={item.id}
                  item={item}
                  repoKey={repoKey}
                  x={metrics.lefts[column]}
                  y={y}
                  width={metrics.widths[column]}
                  height={metrics.rowHeight}
                  dense={zoom === "year"}
                  selectMode={selectMode}
                  selected={selectMode && selectedIds.has(item.id)}
                  badge={badgeFor ? badgeFor(item) : null}
                />
              );
            }
          }
          const people = zoom === "day" && groupPeople ? groupPeople(group) : null;
          return (
            <section
              key={group.key}
              aria-label={group.label}
              className="absolute inset-x-0"
              style={{ top: layout.top, height: layout.height }}
            >
              <div
                data-group-header=""
                className="lp-day sticky z-10 flex items-end gap-3 bg-bg px-4 pb-2 sm:px-0"
                style={{ top: stickyTop, height: metrics.header }}
              >
                <div className="min-w-0 flex-1">
                  <h2 className={`truncate text-ink ${HEADER_TITLE[zoom]}`}>
                    {group.title ?? group.label}
                    {group.titleSuffix && <span className="font-semibold text-ink-muted"> {group.titleSuffix}</span>}
                  </h2>
                  <p className="truncate text-[13px] leading-[18px] text-ink-muted tabular-nums">
                    {group.meta ?? itemCount(group.items.length)}
                  </p>
                </div>
                {people && people.length > 0 && (
                  <span aria-label={`${people.length === 1 ? "1 person" : `${people.length} people`} in these photos`} role="img" className="mb-1 flex shrink-0 items-center">
                    {people.map((person, i) => (
                      <span key={person.id} className={`block rounded-full border-2 border-bg ${i > 0 ? "-ml-2" : ""}`} style={{ zIndex: 3 - i }}>
                        <FaceAvatar repoKey={repoKey} cover={person.cover} entry={person.entry} className="h-6 w-6" />
                      </span>
                    ))}
                  </span>
                )}
                {onToggleGroup && (
                  <button
                    type="button"
                    data-group-key={group.key}
                    data-selecting={selectMode}
                    aria-label={allSelected ? `Deselect ${group.label}` : `Select ${group.label}`}
                    aria-pressed={selectMode ? allSelected : undefined}
                    className={`lp-day-check relative mb-1 flex shrink-0 self-end rounded-full outline-none after:absolute after:-inset-[10px] after:content-[''] focus-visible:ring-2 focus-visible:ring-accent ${
                      selectMode ? "" : "[@media(hover:none)]:hidden"
                    }`}
                  >
                    <RoundCheck selected={allSelected} onPhoto={false} />
                  </button>
                )}
              </div>
              {tiles}
            </section>
          );
        })}
      {scrubberHost &&
        width > 0 &&
        createPortal(
          <TimelineScrubber scrollRef={scrollRef} gridRef={gridRef} marks={marks} total={total} stickyTop={stickyTop} />,
          scrubberHost
        )}
    </div>
  );
}
