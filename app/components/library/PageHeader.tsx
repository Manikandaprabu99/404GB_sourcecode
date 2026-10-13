"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Shown in the collapsed bar when `title` isn't plain text. */
  compactTitle?: ReactNode;
  /** A sentence under the title (e.g. "12 people"). */
  subtitle?: ReactNode;
  /** A telemetry line under the title, e.g. <Telemetry items={["12,431 items", "38.2 GB"]} />. */
  telemetry?: ReactNode;
  /** e.g. a back button (a 40px IconButton), shown before the title. */
  leading?: ReactNode;
  /** Right-side actions: 40px IconButtons, a StatusBadge… */
  actions?: ReactNode;
  /** Pinned under the bar (stays when the header collapses). */
  children?: ReactNode;
  /** "large" (default): the big title collapses into the compact bar after ~24px of scroll.
   * "compact": always the compact bar. */
  variant?: "large" | "compact";
  /** "wide" (default): lined up with max-w-6xl screens. "column": a centred 720px column
   * (Settings on desktop). */
  width?: "wide" | "column";
}

const COLLAPSE_AFTER_PX = 24;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return node;
  }
  return null;
}

/**
 * True once `sentinel` has scrolled above the top of its scroll container (or the viewport).
 * Put a 1px element where the content should count as "scrolled", e.g. 24px from the top.
 * An IntersectionObserver, so nothing runs per scroll event.
 */
export function useScrolledPast(sentinel: RefObject<HTMLElement>): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const top = entry.rootBounds?.top ?? 0;
        setPast(!entry.isIntersecting && entry.boundingClientRect.top < top);
      },
      { root: scrollParent(el), threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [sentinel]);
  return past;
}

/**
 * Screen header (docs/DESIGN.md › Page header). A large display title with an optional
 * telemetry line; after a little scroll it collapses into a compact blurred bar with the
 * title in the h3 role. The bar is sticky (on phones it is the top bar, so it pads for the
 * status bar); leading and actions live in it in both states.
 */
export default function PageHeader({
  title,
  compactTitle,
  subtitle,
  telemetry,
  leading,
  actions,
  children,
  variant = "large",
  width = "wide",
}: PageHeaderProps) {
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const scrolled = useScrolledPast(sentinelRef);
  const compact = variant === "compact";
  const collapsed = compact || scrolled;
  const maxWidth = width === "column" ? "max-w-[720px]" : "max-w-6xl";

  return (
    <>
      <span
        ref={sentinelRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 h-px w-px"
        style={{ top: COLLAPSE_AFTER_PX }}
      />
      <header
        className={`sticky top-0 z-30 border-b pt-safe transition-[background-color,border-color] duration-200 ease-out-expo sm:pt-0 ${
          collapsed ? "glass-bg border-border/60" : "border-transparent bg-bg"
        }`}
      >
        <div className={`mx-auto flex h-14 w-full ${maxWidth} items-center gap-1 px-2 sm:px-6`}>
          {leading}
          <div className={`grid min-w-0 flex-1 items-center ${leading ? "pl-2" : "pl-2 sm:pl-0"}`}>
            <h1
              className={`col-start-1 row-start-1 min-w-0 truncate text-ink transition-[opacity,transform] duration-250 ease-out-expo ${
                compact ? "text-h3" : "origin-left font-display text-h1"
              } ${collapsed && !compact ? "-translate-y-1 scale-[0.96] opacity-0" : ""}`}
            >
              {title}
            </h1>
            {!compact && (
              <p
                aria-hidden="true"
                className={`col-start-1 row-start-1 min-w-0 truncate text-h3 text-ink transition-[opacity,transform] duration-250 ease-out-expo ${
                  collapsed ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"
                }`}
              >
                {compactTitle ?? title}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2 pl-1">{actions}</div>}
        </div>
        {children}
      </header>
      {(telemetry || subtitle) && (
        // Lined up with the title: 16px (24px from sm), or after a 40px leading button.
        <div
          className={`mx-auto flex w-full ${maxWidth} flex-col gap-1 px-4 pb-3 sm:px-6 ${
            leading ? "pl-[60px] sm:pl-[76px]" : ""
          }`}
        >
          {telemetry && (typeof telemetry === "string" ? <p className="telemetry truncate text-ink-muted">{telemetry}</p> : telemetry)}
          {subtitle && <p className="truncate text-small text-ink-muted">{subtitle}</p>}
        </div>
      )}
    </>
  );
}
