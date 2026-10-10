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
import type { MediaIndexEntry } from "@/lib/media";
import { useIsomorphicLayoutEffect } from "@/lib/library/hooks";
import { getGridWidth, setGridWidth } from "@/lib/library/viewState";
import { CheckIcon, HeartIcon, PlayIcon } from "@/app/components/library/icons";
import type { DateGroup } from "./dateGroups";
import GalleryThumb from "./GalleryThumb";

export function columnsForWidth(width: number): number {
  if (width >= 1200) return 6;
  if (width >= 900) return 5;
  if (width >= 640) return 4;
  return 3;
}

export function gapForWidth(width: number): number {
  return width >= 640 ? 4 : 2;
}

export const GROUP_HEADER_HEIGHT = 44;
const GROUP_GAP = 10;
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
  rowHeight: number;
  /** Integer left edge and width per column, so tiles fill the row exactly. */
  lefts: number[];
  widths: number[];
}

function computeMetrics(width: number): Metrics {
  const columns = columnsForWidth(width);
  const gap = gapForWidth(width);
  const tile = (width - gap * (columns - 1)) / columns;
  const lefts: number[] = [];
  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    const left = Math.round(c * (tile + gap));
    const right = Math.round(c * (tile + gap) + tile);
    lefts.push(left);
    widths.push(Math.max(1, right - left));
  }
  return { columns, gap, rowHeight: Math.max(1, Math.round(tile)), lefts, widths };
}

function layoutGroups(groups: DateGroup[], metrics: Metrics) {
  let y = 0;
  const layouts: GroupLayout[] = groups.map((group, index) => {
    const rows = Math.ceil(group.items.length / metrics.columns);
    const height =
      GROUP_HEADER_HEIGHT +
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

  const metrics = useMemo(() => computeMetrics(width > 0 ? width : 360), [width]);
  const { layouts, total } = useMemo(() => layoutGroups(groups, metrics), [groups, metrics]);

  const updateWindow = useCallback(() => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    if (!scroller || !grid) return;
    const viewTop = scroller.getBoundingClientRect().top - grid.getBoundingClientRect().top;
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
    const onScroll = () => {
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
      const rowsTop = layout.top + GROUP_HEADER_HEIGHT;
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
            const y = GROUP_HEADER_HEIGHT + row * (metrics.rowHeight + metrics.gap);
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
                className="sticky z-10 flex items-center gap-2.5 bg-bg px-3 sm:px-1"
                style={{ top: stickyTop, height: GROUP_HEADER_HEIGHT }}
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
                <h2 className="truncate text-small font-semibold text-ink">{group.label}</h2>
              </div>
              {tiles}
            </section>
          );
        })}
    </div>
  );
}
