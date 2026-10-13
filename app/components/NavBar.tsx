"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { closeOverlaysThen, hasOpenOverlay } from "@/lib/library/history";
import { SCROLL_TOP_EVENT } from "@/lib/library/viewState";
import { AlbumsIcon, PhotosIcon, SettingsIcon, UploadIcon } from "./library/icons";
import BrandMark from "./ui/BrandMark";

interface Tab {
  href: string;
  label: string;
  Icon: ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  matches: (pathname: string) => boolean;
}

const TABS: Tab[] = [
  { href: "/gallery", label: "Photos", Icon: PhotosIcon, matches: (p) => p === "/gallery" || p.startsWith("/gallery/") },
  {
    href: "/albums",
    label: "Albums",
    Icon: AlbumsIcon,
    // People live on the Albums screen.
    matches: (p) => p === "/albums" || p.startsWith("/albums/") || p === "/people" || p.startsWith("/people/"),
  },
  { href: "/upload", label: "Upload", Icon: UploadIcon, matches: (p) => p === "/upload" },
  {
    href: "/settings",
    label: "Settings",
    Icon: SettingsIcon,
    matches: (p) => p === "/settings" || p.startsWith("/settings/") || p === "/repos",
  },
];

function activeTabFor(pathname: string): string | null {
  return TABS.find((tab) => tab.matches(pathname))?.href ?? null;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Survives remounts: pages outside the (app) layout render their own NavBar, so
// a fresh instance starts from the previous tab and animates to the new one.
let lastShownTab: string | null = null;

// The desktop underline is this wide at scale 1; scaling it to each tab's text width keeps
// the move transform-only, and the factor stays near 1 so its rounded ends don't distort.
const UNDERLINE_BASE_PX = 56;
const TAB_PADDING_PX = 12;

// The phone tile slides for 340ms; the lime fills it in near the end of the move.
const FILL_DELAY_MS = 200;

/**
 * Primary navigation (docs/DESIGN.md › Bottom nav): a floating tab bar on phones whose lime
 * tile slides to the tapped tab and fills in, and a top bar with the wordmark and a sliding
 * underline tile on wider screens. Rendered once by app/(app)/layout.tsx; pages outside
 * that layout (Repos) may render it themselves.
 */
export default function NavBar({ repoLabel }: { repoLabel?: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const routeTab = activeTabFor(pathname);
  // Highlight the tapped tab immediately instead of after the route loads.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? routeTab;
  const [shownTab, setShownTab] = useState<string | null>(() => lastShownTab ?? activeTab);
  // False until the tile first moves: the very first fill shows without waiting for a slide.
  const [moved, setMoved] = useState(false);
  const desktopTabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());
  const shownIndex = TABS.findIndex((tab) => tab.href === shownTab);

  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  // Desktop: slide the underline under the shown tab (positioned without a transition the first time).
  useIsomorphicLayoutEffect(() => {
    const indicator = indicatorRef.current;
    const tab = shownTab ? tabRefs.current.get(shownTab) : undefined;
    if (!indicator) return;
    if (!tab || tab.offsetWidth === 0) {
      indicator.style.opacity = "0";
      return;
    }
    const first = indicator.dataset.placed !== "true";
    if (first) indicator.style.transition = "none";
    placeUnderline(indicator, tab);
    if (first) {
      void indicator.getBoundingClientRect();
      indicator.style.transition = "";
      indicator.dataset.placed = "true";
    }
  }, [shownTab]);

  // Move from the previously shown tab to the active one. Forcing a style
  // flush first makes the change a real CSS transition even on a fresh mount.
  useIsomorphicLayoutEffect(() => {
    lastShownTab = activeTab;
    if (shownTab === activeTab) return;
    void desktopTabsRef.current?.getBoundingClientRect();
    if (shownTab !== null) setMoved(true);
    setShownTab(activeTab);
  }, [activeTab, shownTab]);

  useEffect(() => {
    const container = desktopTabsRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const indicator = indicatorRef.current;
      const tab = lastShownTab ? tabRefs.current.get(lastShownTab) : undefined;
      if (!indicator || !tab || tab.offsetWidth === 0) return;
      placeUnderline(indicator, tab);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function onTabClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (pathname === href) {
      event.preventDefault();
      window.dispatchEvent(new Event(SCROLL_TOP_EVENT));
      return;
    }
    setPendingTab(href);
    // A selection, sheet or search open on this screen owns a history entry; close it first.
    if (hasOpenOverlay()) {
      event.preventDefault();
      closeOverlaysThen(() => router.push(href));
    }
  }

  const registerTab = (href: string) => (el: HTMLAnchorElement | null) => {
    if (el) tabRefs.current.set(href, el);
    else tabRefs.current.delete(href);
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="glass sticky top-0 z-nav hidden shrink-0 border-b border-border/60 pt-safe sm:block"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-7 px-6">
          <Link href="/gallery" className="flex shrink-0 items-center gap-2.5 rounded-tile text-ink">
            <BrandMark className="h-7 w-7" />
            <span className="font-display text-base font-bold tracking-[-0.02em]">404GB</span>
          </Link>

          <div ref={desktopTabsRef} className="relative flex h-full items-stretch">
            {TABS.map(({ href, label }) => {
              const on = shownTab === href;
              return (
                <Link
                  key={href}
                  ref={registerTab(href)}
                  href={href}
                  onClick={(e) => onTabClick(e, href)}
                  aria-current={routeTab === href ? "page" : undefined}
                  className={`relative flex items-center text-small font-medium transition-colors duration-180 focus-visible:outline-offset-[-6px] ${
                    on ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                  style={{ paddingInline: TAB_PADDING_PX }}
                >
                  {label}
                </Link>
              );
            })}
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="pointer-events-none absolute bottom-0 left-0 h-1 origin-left rounded-[2px] bg-signal opacity-0 transition-[transform,opacity] duration-340 ease-spring-soft"
              style={{ width: UNDERLINE_BASE_PX }}
            />
          </div>

          {repoLabel && (
            <Link
              href="/settings"
              title={repoLabel}
              className="ml-auto hidden h-8 max-w-[16rem] items-center gap-2 rounded-tile-sm bg-surface-2 px-2.5 font-mono text-[12px] text-ink-muted transition-colors duration-180 hover:text-ink md:flex"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-signal" />
              <span className="truncate">{repoLabel}</span>
            </Link>
          )}
        </div>
      </nav>

      <nav aria-label="Primary" className="fixed bottom-safe-3 left-safe-3 right-safe-3 z-nav sm:hidden">
        <div className="glass relative mx-auto flex h-16 max-w-md items-stretch rounded-nav border border-border/70 shadow-elevated">
          {/* The tile: a quarter of the bar wide, sliding by whole quarters. The dashed outline
           * travels; the lime fill is remounted per tab so it fills in after the move. */}
          {shownIndex >= 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-1/4 transition-transform duration-340 ease-spring-soft"
              style={{ transform: `translateX(${shownIndex * 100}%)` }}
            >
              <span className="absolute left-1/2 top-[9px] -ml-[22px] h-[30px] w-11 rounded-tile border-[1.5px] border-dashed border-accent/70" />
              <span
                key={shownTab}
                className="absolute left-1/2 top-[9px] -ml-[22px] h-[30px] w-11 animate-tile-fill rounded-tile bg-signal"
                style={moved ? { animationDelay: `${FILL_DELAY_MS}ms` } : { animationDuration: "0ms" }}
              />
            </span>
          )}
          {TABS.map(({ href, label, Icon }) => {
            const on = shownTab === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={(e) => onTabClick(e, href)}
                aria-current={routeTab === href ? "page" : undefined}
                className="group relative flex min-w-0 flex-1 flex-col items-center rounded-[18px] pt-[9px] focus-visible:outline-offset-[-3px]"
              >
                <span className="flex h-[30px] w-11 items-center justify-center transition-transform duration-120 ease-out-expo group-active:scale-[0.94]">
                  {/* The icon turns dark only once the lime is behind it. */}
                  <span
                    className={`flex transition-colors duration-160 ${on ? "text-signal-ink" : "text-ink-muted"}`}
                    style={on && moved ? { transitionDelay: `${FILL_DELAY_MS}ms` } : undefined}
                  >
                    <Icon size={22} strokeWidth={on ? 2 : 1.8} />
                  </span>
                </span>
                <span
                  className={`mt-[3px] max-w-full truncate px-1 text-micro transition-colors duration-180 ${
                    on ? "font-semibold text-ink" : "font-medium text-ink-muted"
                  }`}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function placeUnderline(indicator: HTMLSpanElement, tab: HTMLAnchorElement) {
  const width = Math.max(8, tab.offsetWidth - 2 * TAB_PADDING_PX);
  indicator.style.transform = `translateX(${tab.offsetLeft + TAB_PADDING_PX}px) scaleX(${width / UNDERLINE_BASE_PX})`;
  indicator.style.opacity = "1";
}
