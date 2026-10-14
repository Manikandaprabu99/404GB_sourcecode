"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface PageHeaderProps {
  title: ReactNode;
  /** Shown in the collapsed bar when `title` isn't plain text. */
  compactTitle?: ReactNode;
  /** A sentence under the title (e.g. "12 people"). */
  subtitle?: ReactNode;
  /** A facts line under the title, e.g. <Telemetry items={["12,431 items", "38.2 GB"]} />. */
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

/** True once the 1px `sentinel` has scrolled above its scroll container (an IntersectionObserver). */
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

/** Screen header: a large title that collapses after 24px of scroll into a compact glass bar
 * with a centred 17px title; leading and actions stay in the bar. */
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
        className={`sticky top-0 z-30 border-b pt-safe transition-[background-color,border-color] duration-240 ease-out-expo sm:pt-0 ${
          collapsed ? "glass-bg border-[rgb(var(--hairline))]" : "border-transparent"
        }`}
      >
        <div className={`relative mx-auto flex h-14 w-full ${maxWidth} items-center gap-1 px-2 sm:h-16 sm:px-6 lg:px-8`}>
          {leading}
          <div className={`grid min-w-0 flex-1 items-center ${leading ? "pl-2" : "pl-2 sm:pl-0"}`}>
            <h1
              className={`col-start-1 row-start-1 min-w-0 truncate text-ink transition-[opacity,transform] duration-240 ease-out-expo ${
                compact ? "text-center text-headline" : "origin-left text-large-title lg:text-large-title-desktop"
              } ${collapsed && !compact ? "-translate-y-1 scale-[0.94] opacity-0" : ""}`}
            >
              {title}
            </h1>
          </div>
          {!compact && (
            <p
              aria-hidden="true"
              className={`pointer-events-none absolute left-1/2 top-1/2 max-w-[52%] -translate-x-1/2 truncate text-headline text-ink transition-[opacity,transform] duration-240 ease-out-expo ${
                collapsed ? "-translate-y-1/2 opacity-100" : "-translate-y-[30%] opacity-0"
              }`}
            >
              {compactTitle ?? title}
            </p>
          )}
          {actions && <div className="relative flex shrink-0 items-center gap-2 pl-1">{actions}</div>}
        </div>
        {children}
      </header>
      {(telemetry || subtitle) && (
        // Lined up with the title (or after a 40px leading button).
        <div
          className={`mx-auto -mt-1 flex w-full ${maxWidth} flex-col gap-0.5 px-4 pb-3 sm:px-6 lg:px-8 ${
            leading ? "pl-[60px] sm:pl-[76px] lg:pl-[84px]" : ""
          }`}
        >
          {telemetry && (typeof telemetry === "string" ? <p className="telemetry truncate">{telemetry}</p> : telemetry)}
          {subtitle && <p className="truncate text-footnote text-ink-muted">{subtitle}</p>}
        </div>
      )}
    </>
  );
}
