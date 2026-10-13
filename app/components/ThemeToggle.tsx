"use client";

// Manual light/dark override, layered on top of `prefers-color-scheme`.
// app/layout.tsx inlines a <head> script that sets the initial `data-theme`
// attribute (from localStorage, falling back to the OS preference) before
// the first paint; SystemBarsSync follows OS and cross-tab changes when no
// choice is stored. This module only flips the attribute and remembers it.
import { useEffect, useState } from "react";
import { iconButtonClass } from "./ui/IconButton";
import SegmentedControl from "./ui/SegmentedControl";

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
      className={`${iconButtonClass({ variant: "tile" })} ${className ?? ""}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        aria-hidden="true"
        className={`absolute transition-[opacity,transform] duration-320 ease-out-expo ${
          theme === "light" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-50 opacity-0"
        }`}
      >
        <circle cx="12" cy="12" r="4.5" />
        <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`absolute transition-[opacity,transform] duration-320 ease-out-expo ${
          theme === "dark" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-50 opacity-0"
        }`}
      >
        <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" />
      </svg>
    </button>
  );
}

/** A tiny tile preview of a theme: its background with one lime tile. */
function ThemePreview({ theme }: { theme: ThemePreference }) {
  const paper = "#F3F2ED";
  const ink = "#0A0A0B";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="shrink-0">
      <defs>
        <clipPath id={`theme-preview-${theme}`}>
          <rect width="16" height="16" rx="4.5" />
        </clipPath>
      </defs>
      <g clipPath={`url(#theme-preview-${theme})`}>
        <rect width="16" height="16" fill={theme === "light" ? paper : ink} />
        {theme === "system" && <path d="M16 0v16H0Z" fill={paper} />}
      </g>
      <rect x="0.5" y="0.5" width="15" height="15" rx="4" fill="none" stroke="currentColor" strokeOpacity="0.25" />
      <rect x="4.5" y="4.5" width="7" height="7" rx="2" fill="#C8F542" />
    </svg>
  );
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

/** Dark / Light / System as a segmented control with tiny previews (Settings › Library). */
export function ThemeChoice({ className }: { className?: string }) {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(getThemePreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) setPreference(getThemePreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <SegmentedControl
      label="Theme"
      value={preference ?? "system"}
      disabled={preference === null}
      options={THEME_OPTIONS.map(({ value, label }) => ({ value, label, icon: <ThemePreview theme={value} /> }))}
      onChange={(value) => {
        setPreference(value);
        setThemePreference(value);
      }}
      className={className}
    />
  );
}
