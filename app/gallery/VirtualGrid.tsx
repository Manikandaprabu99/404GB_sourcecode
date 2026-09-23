"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import type { DateGroup } from "./dateGroups";
import GalleryThumb from "./GalleryThumb";

// Mirrors the Tailwind breakpoints the old plain-grid version used:
// `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`.
function columnsForViewportWidth(width: number): number {
  if (width >= 1280) return 6; // xl
  if (width >= 1024) return 5; // lg
  if (width >= 768) return 4; // md
  if (width >= 640) return 3; // sm
  return 2;
}

const ITEM_GAP = 6; // px
const SECTION_GAP = 28; // px — gap between date groups
const HEADER_HEIGHT = 40; // px — a date group's label row
const OVERSCAN_PX = 800; // render this many px worth of extra rows above/below the viewport
// Must match NavBar's own fixed height (the `h-14` sticky top bar — see the
// note above its export) — sticky date headers pin themselves just below it.
const NAVBAR_HEIGHT = 56;

type Row =
  | { type: "header"; label: string; key: string }
  | { type: "items"; items: MediaIndexEntry[]; key: string };

function buildRows(groups: DateGroup[], columns: number): Row[] {
  const rows: Row[] = [];
  groups.forEach((group, groupIndex) => {
    rows.push({
      type: "header",
      label: group.label,
      key: `h-${groupIndex}-${group.label}`,
    });
    for (let i = 0; i < group.items.length; i += columns) {
      rows.push({
        type: "items",
        items: group.items.slice(i, i + columns),
        key: `r-${groupIndex}-${i}`,
      });
    }
  });
  return rows;
}

interface RowLayout {
  top: number;
  height: number;
  bandEnd: number; // top + height + any leading margin already folded in
}

/** Computes each row's absolute `top`/`height`, folding the section-gap
 * margin (before a header, except the very first row) into `top` so the
 * offsets below don't need to special-case it a second time. */
function layoutRows(rows: Row[], itemSize: number): RowLayout[] {
  let cursor = 0;
  return rows.map((row, i) => {
    const leadingMargin = row.type === "header" && i > 0 ? SECTION_GAP : 0;
    const height = row.type === "header" ? HEADER_HEIGHT : Math.max(1, itemSize);
    const top = cursor + leadingMargin;
    cursor = top + height;
    return { top, height, bandEnd: cursor };
  });
}

/** Finds the [start, end] row index range that overlaps [viewTop, viewBottom]. */
function findVisibleRange(
  layout: RowLayout[],
  viewTop: number,
  viewBottom: number
): [number, number] {
  if (layout.length === 0) return [0, -1];

  let lo = 0;
  let hi = layout.length - 1;
  let start = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (layout[mid].bandEnd < viewTop) {
      lo = mid + 1;
    } else {
      start = mid;
      hi = mid - 1;
    }
  }

  lo = start;
  hi = layout.length - 1;
  let end = layout.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (layout[mid].top > viewBottom) {
      end = mid - 1;
      hi = mid - 1;
    } else {
      end = mid;
      lo = mid + 1;
    }
  }

  return [start, Math.max(start, end)];
}

/** The row index of the date-group header that should currently be "stuck"
 * under the navbar: the last header whose natural top is at or above the
 * pin point `x` (viewport-local target offset). Binary search over just the
 * header rows (sorted by top, same order as `rows`), so this stays cheap
 * even for a library with hundreds of date groups. Returns -1 if no header
 * has scrolled up that far yet (e.g. still at the very top of the list). */
function findCurrentHeaderRowIndex(
  headerRows: { rowIndex: number; top: number }[],
  x: number
): number {
  let lo = 0;
  let hi = headerRows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (headerRows[mid].top <= x) {
      ans = headerRows[mid].rowIndex;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export interface VirtualGridProps {
  groups: DateGroup[];
  repoKey: string;
  /** id -> index within the flat, sorted+filtered item list (for opening the
   * full-screen viewer at the right position). */
  indexById: Map<string, number>;
  onOpen: (globalIndex: number) => void;
}

/**
 * Windowed grid: only mounts DOM nodes (including <img>s) for rows within
 * the viewport plus overscan, so a library of thousands of photos doesn't
 * put thousands of elements in the DOM at once. Hand-rolled rather than a
 * virtualization library, per Section 20 Phase 4 — tracks scroll position
 * relative to this component's own container and absolutely positions each
 * rendered row within a full-height spacer div so native scrolling/scrollbar
 * behavior is unaffected.
 *
 * Date-group headers additionally emulate `position: sticky` (see
 * `findCurrentHeaderRowIndex`): since every row here is already absolutely
 * positioned for virtualization, real CSS sticky isn't available, so the
 * "current" header's rendered `top` is instead clamped to
 * `max(naturalTop, rawScrollOffset + NAVBAR_HEIGHT)` every frame, and a
 * standalone copy is rendered if its row would otherwise be virtualized
 * away entirely (a date group spanning more rows than fit in the overscan
 * window).
 */
export default function VirtualGrid({
  groups,
  repoKey,
  indexById,
  onOpen,
}: VirtualGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [columns, setColumns] = useState(2);
  // `scrollTop` (clamped to >=0) drives which rows are mounted at all;
  // `rawTop` (can be negative, i.e. the container hasn't reached the top of
  // the viewport yet) is what the sticky-header math needs to avoid
  // "sticking" a header before it would naturally have reached that point.
  const [viewport, setViewport] = useState({ scrollTop: 0, rawTop: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    function updateColumns() {
      setColumns(columnsForViewportWidth(window.innerWidth));
    }
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  useEffect(() => {
    let raf = 0;
    function measure() {
      raf = 0;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setViewport({
        scrollTop: Math.max(0, -rect.top),
        rawTop: -rect.top,
        height: window.innerHeight,
      });
    }
    function onScrollOrResize() {
      if (raf) return;
      raf = requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const rows = useMemo(() => buildRows(groups, columns), [groups, columns]);

  const itemSize = useMemo(() => {
    if (containerWidth <= 0) return 0;
    return Math.floor((containerWidth - ITEM_GAP * (columns - 1)) / columns);
  }, [containerWidth, columns]);

  const layout = useMemo(() => layoutRows(rows, itemSize), [rows, itemSize]);
  const totalHeight = layout.length > 0 ? layout[layout.length - 1].bandEnd : 0;

  const [startIdx, endIdx] = useMemo(
    () =>
      findVisibleRange(
        layout,
        viewport.scrollTop - OVERSCAN_PX,
        viewport.scrollTop + viewport.height + OVERSCAN_PX
      ),
    [layout, viewport]
  );

  const headerRows = useMemo(() => {
    const arr: { rowIndex: number; top: number }[] = [];
    rows.forEach((row, i) => {
      if (row.type === "header") arr.push({ rowIndex: i, top: layout[i]?.top ?? 0 });
    });
    return arr;
  }, [rows, layout]);

  const stickyTarget = viewport.rawTop + NAVBAR_HEIGHT;
  const currentHeaderIdx = useMemo(
    () => findCurrentHeaderRowIndex(headerRows, stickyTarget),
    [headerRows, stickyTarget]
  );
  const currentHeaderInSlice =
    currentHeaderIdx >= 0 && currentHeaderIdx >= startIdx && currentHeaderIdx <= endIdx;

  // Before the ResizeObserver reports a real width, render just the probe
  // div so we get a measurement — avoids computing a bogus itemSize of 0.
  if (containerWidth === 0) {
    return <div ref={containerRef} style={{ minHeight: 1, width: "100%" }} />;
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", height: totalHeight, width: "100%" }}
    >
      {layout.slice(startIdx, endIdx + 1).map((rowLayout, i) => {
        const absIndex = startIdx + i;
        const row = rows[absIndex];
        if (row.type === "header") {
          const isPinned = absIndex === currentHeaderIdx;
          const top = isPinned ? Math.max(rowLayout.top, stickyTarget) : rowLayout.top;
          return (
            <h2
              key={row.key}
              style={{
                position: "absolute",
                top,
                left: 0,
                right: 0,
                height: rowLayout.height,
                zIndex: isPinned ? 5 : 1,
              }}
              className={`flex items-center px-1 text-small font-semibold text-ink-muted transition-colors duration-180 ${
                isPinned ? "bg-bg/85 backdrop-blur-sm" : ""
              }`}
            >
              {row.label}
            </h2>
          );
        }
        return (
          <div
            key={row.key}
            style={{
              position: "absolute",
              top: rowLayout.top,
              left: 0,
              right: 0,
              height: rowLayout.height,
              display: "grid",
              gridTemplateColumns: `repeat(${columns}, 1fr)`,
              gap: ITEM_GAP,
            }}
          >
            {row.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="group relative overflow-hidden rounded-lg bg-surface-2 shadow-none transition-shadow duration-250 ease-out-expo hover:shadow-elevated"
                onClick={() => onOpen(indexById.get(item.id) ?? 0)}
              >
                <GalleryThumb
                  repoKey={repoKey}
                  mediaId={item.id}
                  alt={item.filename}
                  hasThumbnail={Boolean(item.thumb)}
                  isVideo={item.mimeType?.startsWith("video/")}
                  className="h-full w-full object-cover transition-transform duration-250 ease-out-expo group-hover:scale-[1.04] group-active:scale-[0.97]"
                />
                {item.mimeType?.startsWith("video/") && (
                  <>
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-black/55 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-1.5">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] text-white">
                        ▶
                      </span>
                      {typeof item.duration === "number" && item.duration > 0 && (
                        <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {formatDuration(item.duration)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        );
      })}

      {/* Fallback for a date group so large its header row scrolled outside
       * the virtualized/overscan slice entirely — keeps the sticky label
       * showing even mid-scroll through a very large single day. */}
      {currentHeaderIdx >= 0 && !currentHeaderInSlice && rows[currentHeaderIdx]?.type === "header" && (
        <h2
          style={{
            position: "absolute",
            top: stickyTarget,
            left: 0,
            right: 0,
            height: HEADER_HEIGHT,
            zIndex: 5,
          }}
          className="flex items-center bg-bg/85 px-1 text-small font-semibold text-ink-muted backdrop-blur-sm"
        >
          {(rows[currentHeaderIdx] as Extract<Row, { type: "header" }>).label}
        </h2>
      )}
    </div>
  );
}
