"use client";

// Manual light/dark override, layered on top of `prefers-color-scheme`.
// app/layout.tsx inlines a <head> script that sets the initial `data-theme`
// attribute (from localStorage, falling back to the OS preference) before
// the first paint; SystemBarsSync follows OS and cross-tab changes when no
// choice is stored. This module only flips the attribute and remembers it.
import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "404gb-theme";

export type ThemePreference = "light" | "dark" | "system";

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked: behave as "follow the system".
  }
  return "system";
}

/** Applies and remembers a theme choice; "system" follows the OS. */
export function setThemePreference(preference: ThemePreference) {
  const theme = preference === "system" ? systemTheme() : preference;
  try {
    if (preference === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Still applies for this visit, it just won't persist.
  }
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === theme) return;
  const apply = () => root.setAttribute("data-theme", theme);
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof doc.startViewTransition === "function" && !reduceMotion) doc.startViewTransition(apply);
  else apply();
}

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";

  return (
    <button
      type="button"
      onClick={() => setThemePreference(theme === "light" ? "dark" : "light")}
      disabled={theme === null}
      aria-label={label}
      title={label}
      className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-ink-muted transition-all duration-180 ease-out-expo after:absolute after:-inset-1 after:content-[''] hover:border-border-strong hover:text-ink active:scale-90 ${
        className ?? ""
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        aria-hidden="true"
        className={`absolute transition-all duration-320 ease-out-expo ${
          theme === "light" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"
        }`}
      >
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`absolute transition-all duration-320 ease-out-expo ${
          theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0"
        }`}
      >
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
      </svg>
    </button>
  );
}
