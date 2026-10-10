"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/library/hooks";
import { getScrollPosition, SCROLL_TOP_EVENT, setScrollPosition } from "@/lib/library/viewState";

interface ScrollAreaProps {
  /** Scroll position is remembered under this key across tab switches. */
  scrollKey: string;
  /** Restore the remembered position on mount (grids restore it themselves). */
  restore?: boolean;
  /** Extra bottom room for the floating selection bar. */
  selectionInset?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * A screen's own scroll container. Screens scroll inside it rather than the
 * window, so each one keeps its position independently of Next.js's
 * scroll-to-top on navigation. Re-tapping the active tab scrolls it to the top.
 */
const ScrollArea = forwardRef<HTMLDivElement, ScrollAreaProps>(function ScrollArea(
  { scrollKey, restore = true, selectionInset = false, className, children },
  forwardedRef
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement);

  useIsomorphicLayoutEffect(() => {
    const saved = getScrollPosition(scrollKey);
    if (restore && saved && ref.current) ref.current.scrollTop = saved;
  }, [scrollKey, restore]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => setScrollPosition(scrollKey, el.scrollTop);
    const onScrollTop = () => el.scrollTo({ top: 0, behavior: "smooth" });
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener(SCROLL_TOP_EVENT, onScrollTop);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener(SCROLL_TOP_EVENT, onScrollTop);
    };
  }, [scrollKey]);

  return (
    <div
      ref={ref}
      className={`relative h-full overflow-y-auto overflow-x-hidden overscroll-contain ${className ?? ""}`}
    >
      {children}
      <div
        aria-hidden="true"
        className={`transition-[height] duration-250 ease-out-expo ${
          selectionInset
            ? "h-[calc(9rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] sm:h-[calc(6.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
            : "h-[calc(4.75rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] sm:h-[calc(2rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
        }`}
      />
    </div>
  );
});

export default ScrollArea;
