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

/**
 * Primary navigation: a bottom tab bar on phones and a top bar on wider
 * screens. Rendered once by app/(app)/layout.tsx; pages outside that layout
 * (Upload, Repos) may render it themselves.
 */
export default function NavBar({ repoLabel }: { repoLabel?: string }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const routeTab = activeTabFor(pathname);
  // Highlight the tapped tab immediately instead of after the route loads.
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const activeTab = pendingTab ?? routeTab;
  const [shownTab, setShownTab] = useState<string | null>(() => lastShownTab ?? activeTab);
  const desktopTabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef(new Map<string, HTMLAnchorElement>());

  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);

  // Desktop: slide the pill under the shown tab (positioned without a transition the first time).
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
    indicator.style.width = `${tab.offsetWidth}px`;
    indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
    indicator.style.opacity = "1";
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
    setShownTab(activeTab);
  }, [activeTab, shownTab]);

  useEffect(() => {
    const container = desktopTabsRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const indicator = indicatorRef.current;
      const tab = lastShownTab ? tabRefs.current.get(lastShownTab) : undefined;
      if (!indicator || !tab || tab.offsetWidth === 0) return;
      indicator.style.width = `${tab.offsetWidth}px`;
      indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
      indicator.style.opacity = "1";
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
        className="glass sticky top-0 z-nav hidden shrink-0 border-b border-border pt-safe sm:block"
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-6">
          <Link href="/gallery" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight text-ink">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-mono text-[11px] font-bold text-bg">
              gb
            </span>
            <span>404GB</span>
          </Link>

          <div ref={desktopTabsRef} className="relative flex items-center gap-1">
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 w-0 rounded-full bg-surface-3 opacity-0 transition-[transform,width,opacity] duration-320 ease-out-expo"
            />
            {TABS.map(({ href, label, Icon }) => {
              const on = shownTab === href;
              return (
                <Link
                  key={href}
                  ref={registerTab(href)}
                  href={href}
                  onClick={(e) => onTabClick(e, href)}
                  aria-current={routeTab === href ? "page" : undefined}
                  className={`relative flex h-9 items-center gap-2 rounded-full px-3.5 text-small font-medium transition-colors duration-180 ${
                    on ? "text-ink" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <Icon size={17} strokeWidth={on ? 2 : 1.8} />
                  {label}
                </Link>
              );
            })}
          </div>

          {repoLabel && (
            <Link
              href="/settings"
              title={repoLabel}
              className="ml-auto hidden max-w-[14rem] truncate rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-micro text-ink-muted transition-colors duration-180 hover:text-ink md:block"
            >
              {repoLabel}
            </Link>
          )}
        </div>
      </nav>

      <nav
        aria-label="Primary"
        className="glass fixed inset-x-0 bottom-0 z-nav border-t border-border pb-safe pl-safe pr-safe sm:hidden"
      >
        <div className="flex h-16 items-stretch">
          {TABS.map(({ href, label, Icon }) => {
            const on = shownTab === href;
            return (
              <Link
                key={href}
                href={href}
                onClick={(e) => onTabClick(e, href)}
                aria-current={routeTab === href ? "page" : undefined}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 outline-none focus-visible:bg-surface-2"
              >
                <span className="relative flex h-8 w-14 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 rounded-full bg-accent/15 transition-[transform,opacity] duration-320 ease-out-expo ${
                      on ? "scale-100 opacity-100" : "scale-x-50 opacity-0"
                    }`}
                  />
                  <Icon
                    size={22}
                    strokeWidth={on ? 2 : 1.8}
                    className={`relative transition-colors duration-180 ${on ? "text-accent" : "text-ink-muted"}`}
                  />
                </span>
                <span
                  className={`text-micro transition-colors duration-180 ${
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
