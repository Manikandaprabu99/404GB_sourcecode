"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type MouseEvent } from "react";
import { closeOverlaysThen, hasOpenOverlay } from "@/lib/library/history";
import { SCROLL_TOP_EVENT } from "@/lib/library/viewState";
import { select as hapticSelect } from "@/lib/ui/haptics";
import { AlbumsIcon, GithubIcon, PhotosIcon, SettingsIcon, UploadIcon } from "./library/icons";
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
    // People live under Albums.
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

// Survives remounts (Repos renders its own NavBar), so a fresh bar slides from the last tab.
let lastShownTab: string | null = null;

/** Hides the phone bar on fast downward touch/wheel scrolls in Photos; shows it again on the
 * way up, on route changes and whenever an overlay (viewer, sheet) opens or closes. */
function useHideOnScroll(enabled: boolean, pathname: string): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => setHidden(false), [pathname]);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    const last = new WeakMap<EventTarget, number>();
    let userUntil = 0;
    const onUser = () => {
      userUntil = Date.now() + 700;
    };
    const onScroll = (event: Event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement)) return;
      const top = el.scrollTop;
      const prev = last.get(el) ?? top;
      last.set(el, top);
      const dy = top - prev;
      if (top < 120 || dy < -6) setHidden(false);
      else if (dy > 18 && Date.now() < userUntil) setHidden(true);
    };
    const show = () => setHidden(false);
    const observer = new MutationObserver(show);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-system-bars", "data-immersive"] });
    window.addEventListener("touchmove", onUser, { capture: true, passive: true });
    window.addEventListener("wheel", onUser, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("popstate", show);
    return () => {
      observer.disconnect();
      window.removeEventListener("touchmove", onUser, { capture: true });
      window.removeEventListener("wheel", onUser, { capture: true });
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("popstate", show);
    };
  }, [enabled]);
  return hidden;
}

/** Primary navigation: a floating glass capsule on phones, a left sidebar from `sm` (a rail
 * until `lg`). Rendered by app/(app)/layout.tsx; Repos renders its own. */
export default function NavBar({ repoLabel }: { repoLabel?: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const routeTab = activeTabFor(pathname);
  // Highlight the tapped tab immediately instead of after the route loads.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? routeTab;
  const [shownTab, setShownTab] = useState<string | null>(() => lastShownTab ?? activeTab);
  const barRef = useRef<HTMLDivElement>(null);
  const shownIndex = TABS.findIndex((tab) => tab.href === shownTab);
  const hidden = useHideOnScroll(pathname === "/gallery", pathname);

  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  // Flush styles first so a fresh mount still transitions from the previous tab.
  useIsomorphicLayoutEffect(() => {
    lastShownTab = activeTab;
    if (shownTab === activeTab) return;
    void barRef.current?.getBoundingClientRect();
    setShownTab(activeTab);
  }, [activeTab, shownTab]);

  function onTabClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (pathname === href) {
      event.preventDefault();
      window.dispatchEvent(new Event(SCROLL_TOP_EVENT));
      return;
    }
    hapticSelect();
    setPendingTab(href);
    // A selection, sheet or search open on this screen owns a history entry; close it first.
    if (hasOpenOverlay()) {
      event.preventDefault();
      closeOverlaysThen(() => router.push(href));
    }
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="relative z-nav hidden w-20 shrink-0 flex-col border-r border-border/70 bg-surface pb-safe-4 pt-safe-4 sm:flex lg:w-[248px] lg:px-3"
      >
        <Link
          href="/gallery"
          className="mx-auto mb-6 flex h-11 shrink-0 items-center gap-2.5 rounded-control px-1 text-ink lg:mx-0 lg:px-2"
        >
          <BrandMark className="h-9 w-9 shrink-0 drop-shadow-[0_4px_10px_rgb(22_96_235/0.35)]" />
          <span className="hidden text-headline font-bold tracking-[-0.02em] lg:inline">404GB</span>
        </Link>

        {/* --nav-row: one row plus the 4px gap, so the pill moves by whole rows. */}
        <div className="relative flex flex-col gap-1 px-2 [--nav-row:64px] lg:px-0 lg:[--nav-row:48px]">
          {shownIndex >= 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-2 top-0 h-[60px] rounded-control bg-accent-soft transition-transform duration-380 ease-lumen lg:inset-x-0 lg:h-11"
              style={{ transform: `translateY(calc(${shownIndex} * var(--nav-row)))` }}
            />
          )}
          {TABS.map(({ href, label, Icon }) => {
            const on = shownTab === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={(e) => onTabClick(e, href)}
                aria-current={routeTab === href ? "page" : undefined}
                className={`relative flex h-[60px] flex-col items-center justify-center gap-1 rounded-control text-[11px] font-semibold transition-colors duration-180 focus-visible:outline-offset-[-2px] lg:h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-callout ${
                  on ? "text-accent-text" : "text-ink-muted hover:text-ink"
                }`}
              >
                <Icon size={22} strokeWidth={on ? 2.1 : 1.8} />
                <span className="max-w-full truncate">{label}</span>
              </Link>
            );
          })}
        </div>

        {repoLabel && (
          <Link
            href="/settings"
            title={repoLabel}
            className="mt-auto hidden h-11 items-center gap-2.5 rounded-control bg-surface-2 px-3 text-footnote font-medium text-ink-muted transition-colors duration-180 hover:text-ink lg:flex"
          >
            <GithubIcon size={16} />
            <span className="truncate">{repoLabel}</span>
          </Link>
        )}
      </nav>

      <nav
        aria-label="Primary"
        className={`fixed bottom-safe-3 left-safe-4 right-safe-4 z-nav transition-transform duration-380 ease-lumen sm:hidden ${
          hidden ? "translate-y-[calc(100%+24px)]" : ""
        }`}
      >
        <div
          ref={barRef}
          className="glass hairline relative mx-auto flex h-16 max-w-md items-stretch rounded-full px-1.5 shadow-[0_10px_30px_-10px_rgb(0_0_0/0.45)]"
        >
          {shownIndex >= 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1.5 w-[calc((100%-0.75rem)/4)] transition-transform duration-380 ease-lumen"
              style={{ transform: `translateX(${shownIndex * 100}%)` }}
            >
              <span className="absolute left-1/2 top-[7px] h-8 w-14 -translate-x-1/2 rounded-full bg-accent-soft" />
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
                className="group relative flex min-w-0 flex-1 flex-col items-center rounded-full pt-[7px] focus-visible:outline-offset-[-3px]"
              >
                <span
                  className={`flex h-8 w-14 items-center justify-center transition-[color,transform] duration-160 ease-out-expo group-active:scale-[0.9] ${
                    on ? "text-accent-text" : "text-ink-muted"
                  }`}
                >
                  <Icon size={22} strokeWidth={on ? 2.1 : 1.8} />
                </span>
                <span
                  className={`mt-0.5 max-w-full truncate px-1 text-[11px] leading-[14px] transition-colors duration-180 ${
                    on ? "font-semibold text-accent-text" : "font-medium text-ink-muted"
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
