"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import InstallPrompt from "./InstallPrompt";
import ThemeToggle from "./ThemeToggle";

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="M4 17l4.5-4.5a1.5 1.5 0 0 1 2.1 0L15 17M13 15l1.9-1.9a1.5 1.5 0 0 1 2.1 0L20 16" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function RepoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-8l-2-4Z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H8" />
    </svg>
  );
}

const navLinks = [
  { href: "/gallery", label: "Gallery", Icon: GalleryIcon },
  { href: "/upload", label: "Upload", Icon: UploadIcon },
  { href: "/repos", label: "Repo", Icon: RepoIcon },
];

/**
 * NOTE for app/gallery/VirtualGrid.tsx: this bar's own rendered height is a
 * fixed `h-14` (56px) on every breakpoint (see the `<nav>` below) — its
 * sticky date-group headers pin themselves just under that height, so keep
 * this in sync if the height class ever changes. (`pt-safe` can add a
 * device's notch inset on top of that 56px on standalone iOS; the sticky
 * header offset doesn't account for that extra sliver, which is a minor,
 * accepted approximation.)
 */
export default function NavBar({ repoLabel }: { repoLabel?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <>
      {/* Top bar: full nav row on desktop, brand + overflow on mobile. */}
      <nav className="glass sticky top-0 z-40 border-b border-border pt-safe">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink font-mono text-[11px] font-bold text-bg">
                gb
              </span>
              <span className="hidden sm:inline">404GB</span>
            </Link>

            {/* Desktop links, with an animated active-state underline. */}
            <div className="hidden items-center gap-1 sm:flex">
              {navLinks.map(({ href, label }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`relative px-3 py-2 text-small font-medium transition-colors duration-180 ${
                      active ? "text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {label}
                    <span
                      className={`absolute inset-x-3 -bottom-px h-0.5 origin-left rounded-full bg-accent transition-transform duration-250 ease-out-expo ${
                        active ? "scale-x-100" : "scale-x-0"
                      }`}
                    />
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {repoLabel && (
              <span
                title={repoLabel}
                className="hidden max-w-[10rem] truncate rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-micro text-ink-muted md:inline-block"
              >
                {repoLabel}
              </span>
            )}

            {/* Desktop-only actions. */}
            <div className="hidden items-center gap-2 sm:flex">
              <InstallPrompt />
              <ThemeToggle />
              <button
                onClick={logout}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-small text-ink-muted transition-all duration-180 ease-out-expo hover:border-border-strong hover:text-ink"
              >
                <LogoutIcon />
                Log out
              </button>
            </div>

            {/* Mobile overflow menu — Install / Theme / Log out. */}
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                type="button"
                aria-label="More"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-ink-muted transition-colors duration-180 hover:text-ink"
              >
                <MoreIcon />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-11 z-50 w-56 origin-top-right animate-scale-in rounded-xl border border-border bg-surface p-2 shadow-elevated">
                  {repoLabel && (
                    <p className="truncate border-b border-border px-2 pb-2 pt-1 font-mono text-micro text-ink-faint">
                      {repoLabel}
                    </p>
                  )}
                  <div className="flex items-center justify-between px-2 py-2 text-small text-ink-muted">
                    <span>Theme</span>
                    <ThemeToggle />
                  </div>
                  <div className="px-1 pb-1">
                    <InstallPrompt full />
                  </div>
                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-small text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
                  >
                    <LogoutIcon />
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Bottom tab bar — primary nav on phones, mirroring the
       * Gallery/Upload/Repo grouping common to Google Photos/Instagram. */}
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border pb-safe sm:hidden">
        <div className="flex h-16 items-stretch justify-around">
          {navLinks.map(({ href, label, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-w-[64px] flex-1 flex-col items-center justify-center gap-1 py-1.5"
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition-all duration-180 ease-out-expo ${
                    active ? "bg-accent/15 text-accent" : "text-ink-faint"
                  }`}
                >
                  <Icon />
                </span>
                <span className={`text-micro font-medium ${active ? "text-ink" : "text-ink-faint"}`}>
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
