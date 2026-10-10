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
import { createPortal } from "react-dom";
import type { MediaIndexEntry } from "@/lib/media";
import { useIsomorphicLayoutEffect } from "@/lib/library/hooks";
import { getGridWidth, setGridWidth } from "@/lib/library/viewState";
import type { ZoomLevel } from "@/lib/library/zoom";
import { CheckIcon, HeartIcon, PlayIcon } from "@/app/components/library/icons";
import type { DateGroup } from "./dateGroups";
import GalleryThumb from "./GalleryThumb";
import { offsetWithin } from "./layoutMath";
import TimelineScrubber, { type TimelineMark } from "./TimelineScrubber";

export function columnsForWidth(width: number): number {
  if (width >= 1200) return 6;
  if (width >= 900) return 5;
  if (width >= 640) return 4;
  return 3;
}

export function gapForWidth(width: number): number {
  return width >= 640 ? 4 : 2;
}

/** Denser grids for the month and year views, like zooming out in Google Photos. */
const DENSITY: Record<ZoomLevel, { columns: (width: number) => number; gap: (width: number) => number; header: number }> = {
  day: { columns: columnsForWidth, gap: gapForWidth, header: 44 },
  month: {
    columns: (w) => (w >= 1200 ? 10 : w >= 900 ? 8 : w >= 640 ? 7 : 5),
    gap: (w) => (w >= 640 ? 3 : 2),
    header: 56,
  },
  year: {
    columns: (w) => (w >= 1200 ? 15 : w >= 900 ? 12 : w >= 640 ? 10 : 7),
    gap: (w) => (w >= 640 ? 2 : 1),
    header: 60,
  },
};

const HEADER_TEXT: Record<ZoomLevel, string> = {
  day: "text-small font-semibold",
  month: "text-h3 font-semibold",
  year: "text-h2 font-bold tabular-nums",
};

export const GROUP_HEADER_HEIGHT = DENSITY.day.header;
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
  selectMode: boolean;
  selected: boolean;
  onThumbnailBackfilled?: (mediaId: string, thumbPath: string) => void;
}

const Tile = memo(function Tile({
  item,
  repoKey,
  x,
  y,
  width,
  height,
  selectMode,
  selected,
  onThumbnailBackfilled,
}: TileProps) {
  const isVideo = item.mimeType?.startsWith("video/") ?? false;
  return (
    <button
      type="button"
      data-media-id={item.id}
      aria-label={`${isVideo ? "Video" : "Photo"} ${item.filename}`}
      aria-pressed={selectMode ? selected : undefined}
      className={`group absolute left-0 top-0 overflow-hidden outline-none transition-[transform,background-color] duration-320 ease-out-expo [-webkit-touch-callout:none] focus-visible:z-[5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
        selected ? "bg-accent/15" : "bg-surface-2"
      }`}
      style={{ width, height, transform: `translate3d(${x}px, ${y}px, 0)` }}
    >
      <span
        className={`block h-full w-full overflow-hidden transition-[transform,border-radius] duration-180 ease-out-expo ${
          selected ? "scale-[0.84] rounded-lg" : ""
        }`}
      >
        <GalleryThumb
          repoKey={repoKey}
          mediaId={item.id}
          alt=""
          hasThumbnail={Boolean(item.thumb)}
          isVideo={isVideo}
          onThumbnailBackfilled={onThumbnailBackfilled}
          className="h-full w-full object-cover"
        />
      </span>

      {isVideo && (
        <span className="pointer-events-none absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur-sm">
          <PlayIcon size={8} />
          {typeof item.duration === "number" && item.duration > 0 ? formatDuration(item.duration) : null}
        </span>
      )}
      {item.favorite && (
        <HeartIcon
          filled
          size={15}
          strokeWidth={1.5}
          className="pointer-events-none absolute bottom-1.5 left-1.5 text-white drop-shadow-[0_1px_2px_rgb(0_0_0/0.55)]"
        />
      )}

      <span
        data-select-handle=""
        className={`absolute left-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 transition-all duration-180 ease-out-expo ${
          selected
            ? "scale-100 border-accent bg-accent text-accent-ink"
            : "border-white/90 bg-black/20 text-transparent"
        } ${
          selectMode
            ? "pointer-events-none opacity-100"
            : "pointer-events-none opacity-0 group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:pointer-events-auto"
        }`}
      >
        <CheckIcon size={12} />
      </span>
      <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-120 group-active:bg-black/10" />
    </button>
  );
});

export interface VirtualGridProps {
  groups: DateGroup[];
  /** Day, month or year view: tile density and header style. */
  zoom: ZoomLevel;
  /** Pinch or Ctrl+wheel: +1 = zoom out (denser), -1 = zoom in. */
  onZoomStep?: (direction: 1 | -1) => void;
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
  onThumbnailBackfilled?: (mediaId: string, thumbPath: string) => void;
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
  onThumbnailBackfilled,
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

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && typeof grid.animate === "function") {
      const zoomingOut = ["day", "month", "year"].indexOf(zoom) > ["day", "month", "year"].indexOf(prev.zoom);
      grid.style.transformOrigin = `50% ${Math.round(viewTop + scroller.clientHeight / 3)}px`;
      const animation = grid.animate(
        [
          { opacity: 0.25, transform: `scale(${zoomingOut ? 1.08 : 0.92})` },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 280, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
      );
      animation.onfinish = () => updateWindow();
    }
  }, [zoom, layouts, metrics, scrollRef, stickyTop, updateWindow]);

  // Pinch (two fingers) and Ctrl+wheel / trackpad pinch switch between views.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let startDistance = 0;
    let fired = false;
    let wheelDelta = 0;
    let wheelBlockedUntil = 0;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startDistance = distance(e.touches);
        fired = false;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDistance <= 0 || fired) return;
      const ratio = distance(e.touches) / startDistance;
      if (ratio >= PINCH_OUT_RATIO) {
        fired = true;
        onZoomStepRef.current?.(-1);
      } else if (ratio <= PINCH_IN_RATIO) {
        fired = true;
        onZoomStepRef.current?.(1);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDistance = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !onZoomStepRef.current) return;
      e.preventDefault(); // otherwise the browser zooms the whole page
      const now = performance.now();
      if (now < wheelBlockedUntil) return;
      wheelDelta += e.deltaY;
      if (Math.abs(wheelDelta) >= WHEEL_STEP) {
        onZoomStepRef.current(wheelDelta > 0 ? 1 : -1);
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
    };
  }, [scrollRef]);

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
  const handlers = useRef({ onOpen, onToggleSelect, onStartSelect, onToggleGroup, selectMode });
  handlers.current = { onOpen, onToggleSelect, onStartSelect, onToggleGroup, selectMode };

  const pressRef = useRef<{ id: string; x: number; y: number; timer: number; fired: boolean } | null>(
    null
  );

  const clearPress = useCallback(() => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  useEffect(() => clearPress, [clearPress]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      clearPress();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const tile = (e.target as Element).closest<HTMLElement>("[data-media-id]");
      const id = tile?.dataset.mediaId;
      if (!id) return;
      const press = { id, x: e.clientX, y: e.clientY, timer: 0, fired: false };
      press.timer = window.setTimeout(() => {
        press.fired = true;
        navigator.vibrate?.(12);
        const { selectMode: selecting, onStartSelect: start, onToggleSelect: toggle } = handlers.current;
        if (selecting) toggle(id, false);
        else start(id);
      }, LONG_PRESS_MS);
      pressRef.current = press;
    },
    [clearPress]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (!press || press.fired) return;
      if (
        Math.abs(e.clientX - press.x) > LONG_PRESS_SLOP_PX ||
        Math.abs(e.clientY - press.y) > LONG_PRESS_SLOP_PX
      ) {
        clearPress();
      }
    },
    [clearPress]
  );

  const onPointerEnd = useCallback(() => {
    // A fired press stays recorded so the click that follows it is swallowed.
    if (pressRef.current && !pressRef.current.fired) clearPress();
  }, [clearPress]);

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
                  selectMode={selectMode}
                  selected={selectMode && selectedIds.has(item.id)}
                  onThumbnailBackfilled={onThumbnailBackfilled}
                />
              );
            }
          }
          return (
            <section
              key={group.key}
              aria-label={group.label}
              className="absolute inset-x-0"
              style={{ top: layout.top, height: layout.height }}
            >
              <div
                className={`sticky z-10 flex items-center gap-2.5 bg-bg px-3 sm:px-1 ${zoom === "day" ? "" : "pt-2"}`}
                style={{ top: stickyTop, height: metrics.header }}
              >
                {selectMode && onToggleGroup && (
                  <button
                    type="button"
                    data-group-key={group.key}
                    aria-label={allSelected ? `Deselect ${group.label}` : `Select ${group.label}`}
                    aria-pressed={allSelected}
                    className={`flex h-[22px] w-[22px] shrink-0 animate-scale-in items-center justify-center rounded-full border-2 transition-colors duration-180 ${
                      allSelected
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-ink-faint text-transparent hover:border-ink-muted"
                    }`}
                  >
                    <CheckIcon size={12} />
                  </button>
                )}
                <h2 className={`truncate text-ink ${HEADER_TEXT[zoom]}`}>{group.label}</h2>
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
