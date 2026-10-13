"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { shortMonthLabel } from "./dateGroups";
import { offsetWithin } from "./layoutMath";

export interface TimelineMark {
  /** Top of a date group inside the grid (px). */
  top: number;
  /** Gallery date of the group's newest item (epoch ms); 0 when unknown. */
  time: number;
}

interface TimelineScrubberProps {
  scrollRef: RefObject<HTMLElement>;
  gridRef: RefObject<HTMLElement>;
  /** Date groups in grid order (newest first, so tops ascend). */
  marks: TimelineMark[];
  /** Grid height (px). */
  total: number;
  /** Height of the sticky header covering the top of the scroller. */
  stickyTop: number;
}

const THUMB_HEIGHT = 40;
const HIDE_AFTER_MS = 1500;
const MIN_MARKER_GAP_PX = 20;
/** Only worth showing when there is a lot to scroll through. */
const MIN_PAGES = 1.15;

interface Geometry {
  scroller: HTMLElement;
  maxScroll: number;
  /** Where the grid starts inside the scroller's content. */
  gridOffset: number;
  /** Travel of the thumb's top edge (px). */
  track: number;
}

/**
 * Google-Photos-style fast scroller: a handle on the right edge that appears
 * while scrolling. Dragging it jumps through the timeline with a month bubble
 * and year markers; on desktop the strip also responds to hover and clicks.
 */
export default function TimelineScrubber({ scrollRef, gridRef, marks, total, stickyTop }: TimelineScrubberProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const grabOffset = useRef(THUMB_HEIGHT / 2);
  const draggingRef = useRef(false);
  const hoveringRef = useRef(false);
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [finePointer, setFinePointer] = useState(false);
  const [label, setLabel] = useState("");
  const [markers, setMarkers] = useState<{ y: number; label: string }[]>([]);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setFinePointer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const geometry = useCallback((): Geometry | null => {
    const scroller = scrollRef.current;
    const grid = gridRef.current;
    const root = rootRef.current;
    if (!scroller || !grid || !root) return null;
    return {
      scroller,
      maxScroll: Math.max(1, scroller.scrollHeight - scroller.clientHeight),
      gridOffset: offsetWithin(grid, scroller),
      track: Math.max(1, root.clientHeight - THUMB_HEIGHT),
    };
  }, [scrollRef, gridRef]);

  const labelAt = useCallback(
    (scrollTop: number, gridOffset: number): string => {
      if (marks.length === 0) return "";
      const viewTop = scrollTop - gridOffset + stickyTop + 1;
      let lo = 0;
      let hi = marks.length - 1;
      let found = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (marks[mid].top <= viewTop) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return shortMonthLabel(marks[found].time);
    },
    [marks, stickyTop]
  );

  const place = useCallback(() => {
    const g = geometry();
    const thumb = thumbRef.current;
    if (!g || !thumb) return;
    const y = Math.min(g.track, Math.max(0, (g.scroller.scrollTop / g.maxScroll) * g.track));
    thumb.style.transform = `translate3d(0, ${y}px, 0)`;
  }, [geometry]);

  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!draggingRef.current && !hoveringRef.current) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  // Enabled only when the list is long enough; the thumb follows the scroll position.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const measure = () => setEnabled(marks.length > 1 && total > scroller.clientHeight * MIN_PAGES);
    const onScroll = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          place();
        });
      }
      setVisible(true);
      scheduleHide();
    };
    measure();
    place();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => {
      measure();
      place();
    });
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, marks.length, total, place, scheduleHide]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    if (enabled) place();
  }, [enabled, place]);

  const computeMarkers = useCallback(() => {
    const g = geometry();
    if (!g) return;
    const out: { y: number; label: string }[] = [];
    let lastYear: number | null = null;
    let lastY = -Infinity;
    for (const mark of marks) {
      if (mark.time <= 0) continue;
      const year = new Date(mark.time).getFullYear();
      if (year === lastYear) continue;
      lastYear = year;
      const position = Math.min(g.maxScroll, Math.max(0, g.gridOffset + mark.top - stickyTop));
      const y = (position / g.maxScroll) * g.track + THUMB_HEIGHT / 2;
      if (y - lastY < MIN_MARKER_GAP_PX) continue;
      lastY = y;
      out.push({ y, label: String(year) });
    }
    setMarkers(out);
  }, [geometry, marks, stickyTop]);

  const scrollToPointer = useCallback(
    (clientY: number) => {
      const g = geometry();
      const root = rootRef.current;
      if (!g || !root) return;
      const rect = root.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientY - rect.top - grabOffset.current) / g.track));
      const top = Math.round(fraction * g.maxScroll);
      g.scroller.scrollTop = top;
      setLabel(labelAt(top, g.gridOffset));
    },
    [geometry, labelAt]
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const thumb = thumbRef.current;
    if (!thumb) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = thumb.getBoundingClientRect();
    const onThumb = e.clientY >= rect.top && e.clientY <= rect.bottom;
    grabOffset.current = onThumb ? e.clientY - rect.top : THUMB_HEIGHT / 2;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setVisible(true);
    computeMarkers();
    if (onThumb) {
      const g = geometry();
      if (g) setLabel(labelAt(g.scroller.scrollTop, g.gridOffset));
    } else {
      scrollToPointer(e.clientY);
    }
    navigator.vibrate?.(8);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) scrollToPointer(e.clientY);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    scheduleHide();
  };

  const setHover = (value: boolean) => {
    hoveringRef.current = value;
    setHovering(value);
    if (value) {
      setVisible(true);
      computeMarkers();
    } else {
      scheduleHide();
    }
  };

  if (!enabled) return null;

  // With a mouse it stays visible like a scrollbar; on touch it shows while scrolling.
  const shown = finePointer || visible || dragging || hovering;
  const showMarkers = dragging || hovering;
  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return (
    <div ref={rootRef} className="absolute inset-0">
      {/* Year markers in the telemetry face. No blur: the grid scrolls under them. */}
      {showMarkers &&
        markers.map((marker) => (
          <span
            key={marker.label}
            className="telemetry pointer-events-none absolute right-11 -translate-y-1/2 animate-fade-in rounded-[5px] border border-border/60 bg-surface/95 px-1.5 py-[3px] text-ink-muted shadow-soft"
            style={{ top: marker.y }}
          >
            {marker.label}
          </span>
        ))}

      {/* Desktop: the whole strip takes hover and clicks, like a scrollbar track. */}
      {finePointer && (
        <div
          className="pointer-events-auto absolute inset-y-0 right-0 w-5 cursor-pointer"
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => setHover(false)}
          {...dragHandlers}
        />
      )}

      <div
        ref={thumbRef}
        role="scrollbar"
        aria-label="Jump to a date"
        aria-orientation="vertical"
        aria-controls="library-grid"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(
          scrollRef.current ? (scrollRef.current.scrollTop / Math.max(1, scrollRef.current.scrollHeight - scrollRef.current.clientHeight)) * 100 : 0
        )}
        className={`absolute right-1.5 top-0 flex h-10 items-center transition-opacity duration-250 ${
          shown ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{ touchAction: "none" }}
        onPointerEnter={finePointer ? () => setHover(true) : undefined}
        onPointerLeave={finePointer ? () => setHover(false) : undefined}
        {...dragHandlers}
      >
        {/* The month being scrubbed to, in a signal bubble (OCT 2024). */}
        {dragging && label && (
          <span className="telemetry pointer-events-none mr-2 flex h-9 animate-scale-in items-center whitespace-nowrap rounded-tile bg-signal px-3 text-[12px] text-signal-ink shadow-elevated">
            {label}
          </span>
        )}
        {/* The handle is a tile, like every knob in the app: 30×40, two chevrons. */}
        <span
          className={`flex h-10 w-[30px] cursor-grab flex-col items-center justify-center gap-[3px] rounded-tile border border-border-strong/60 bg-surface-3 text-ink-muted shadow-soft transition-[transform,color] duration-180 ease-out-expo active:cursor-grabbing ${
            dragging ? "scale-105 text-ink" : ""
          }`}
        >
          <svg viewBox="0 0 12 7" width="11" height="6" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 5.5 6 1.5l4.5 4" />
          </svg>
          <svg viewBox="0 0 12 7" width="11" height="6" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 1.5 6 5.5l4.5-4" />
          </svg>
        </span>
      </div>
    </div>
  );
}
