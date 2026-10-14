"use client";

// Theme controls on top of lib/ui/appearance.ts, which owns the stored choices.
import { useEffect, useState } from "react";
import {
  getAppearance,
  resolvedTheme,
  setAppearance,
  STORAGE_KEYS,
  subscribeAppearance,
  type ThemePreference,
} from "@/lib/ui/appearance";
import { iconButtonClass } from "./ui/IconButton";
import SegmentedControl from "./ui/SegmentedControl";

export type { ThemePreference } from "@/lib/ui/appearance";

export const THEME_STORAGE_KEY = STORAGE_KEYS.theme;

export function getThemePreference(): ThemePreference {
  return getAppearance().theme;
}

/** Applies and remembers a theme choice; "system" follows the OS. */
export function setThemePreference(preference: ThemePreference) {
  setAppearance({ theme: preference });
}

export default function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(resolvedTheme());
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

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** System / Light / Dark as a segmented control (Settings › Appearance). */
export function ThemeChoice({ className }: { className?: string }) {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(getThemePreference());
    return subscribeAppearance((appearance) => setPreference(appearance.theme));
  }, []);

  return (
    <SegmentedControl
      label="Theme"
      value={preference ?? "system"}
      disabled={preference === null}
      options={THEME_OPTIONS}
      onChange={(value) => {
        setPreference(value);
        setThemePreference(value);
      }}
      className={className}
    />
  );
}
