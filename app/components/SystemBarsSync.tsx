"use client";

// Keeps the browser/system chrome matched to the page:
//  - Android app: status/navigation bar icon color via Capacitor's SystemBars,
//    and hiding the bars while an overlay asks for immersive mode.
//  - Browsers: <meta name="theme-color"> follows the in-app theme override.
// Overlays drive it declaratively through attributes on <html>:
//   data-system-bars="dark" | "light"  → force a tone (e.g. the black photo viewer)
//   data-immersive="true"              → hide the system bars (app only)
import { useEffect } from "react";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { isNativeApp } from "@/lib/native/platform";
import { THEME_STORAGE_KEY } from "./ThemeToggle";

// The --bg tokens of globals.css ("Paper" and "Ink").
const THEME_COLORS = { light: "#f3f2ed", dark: "#0a0a0b" } as const;
const OVERLAY_COLOR = "#000000";

function currentTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export default function SystemBarsSync() {
  useEffect(() => {
    const root = document.documentElement;
    const native = isNativeApp();
    let lastStyle: SystemBarsStyle | null = null;
    let lastHidden: boolean | null = null;

    const apply = () => {
      const override = root.dataset.systemBars;
      const forced = override === "dark" || override === "light" ? override : null;
      const tone = forced ?? currentTheme();

      const color = forced === "dark" ? OVERLAY_COLOR : THEME_COLORS[tone];
      document
        .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute("content", color));

      if (!native) return;
      // SystemBarsStyle.Dark = light icons (for dark backgrounds), Light = dark icons.
      const style = tone === "dark" ? SystemBarsStyle.Dark : SystemBarsStyle.Light;
      if (style !== lastStyle) {
        lastStyle = style;
        SystemBars.setStyle({ style }).catch(() => {});
      }
      const hidden = root.dataset.immersive === "true";
      if (hidden !== lastHidden) {
        lastHidden = hidden;
        (hidden ? SystemBars.hide() : SystemBars.show()).catch(() => {});
      }
    };

    // No stored choice means "follow the OS", live — and other tabs' choices apply here too.
    const syncTheme = () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(THEME_STORAGE_KEY);
      } catch {
        // Storage blocked: keep following the OS.
      }
      const theme =
        stored === "light" || stored === "dark"
          ? stored
          : window.matchMedia("(prefers-color-scheme: light)").matches
            ? "light"
            : "dark";
      if (root.getAttribute("data-theme") !== theme) root.setAttribute("data-theme", theme);
      else apply();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) syncTheme();
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-system-bars", "data-immersive"],
    });
    const media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", syncTheme);
    window.addEventListener("storage", onStorage);
    // Android can reset bar styling while the app is in the background.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      lastStyle = null;
      lastHidden = null;
      apply();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      observer.disconnect();
      media.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
