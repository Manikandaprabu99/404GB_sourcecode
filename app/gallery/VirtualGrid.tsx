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

const ITEM_GAP = 8; // px — matches the old grid's `gap-2`
const SECTION_GAP = 32; // px — matches the flex column's `gap-8` between date groups
const HEADER_HEIGHT = 32; // px — a date group's label row
const OVERSCAN_PX = 800; // render this many px worth of extra rows above/below the viewport

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
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });

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
        const row = rows[startIdx + i];
        if (row.type === "header") {
          return (
            <h2
              key={row.key}
              style={{
                position: "absolute",
                top: rowLayout.top,
                left: 0,
                right: 0,
                height: rowLayout.height,
              }}
              className="flex items-end text-sm font-semibold text-neutral-400"
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
                className="group relative overflow-hidden rounded bg-neutral-900"
                onClick={() => onOpen(indexById.get(item.id) ?? 0)}
              >
                <GalleryThumb
                  repoKey={repoKey}
                  mediaId={item.id}
                  alt={item.filename}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                {item.mimeType?.startsWith("video/") && (
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-1.5">
                    <span className="rounded bg-black/60 px-1 text-[10px] text-white">
                      ▶
                    </span>
                    {typeof item.duration === "number" && item.duration > 0 && (
                      <span className="rounded bg-black/60 px-1 text-[10px] text-white">
                        {formatDuration(item.duration)}
                      </span>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
