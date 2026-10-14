"use client";

// Keeps the browser/system chrome matched to the page:
//  - Android app: status/navigation bar icon color via Capacitor's SystemBars,
//    and hiding the bars while an overlay asks for immersive mode.
//  - Browsers: <meta name="theme-color"> follows the page background (theme, Pure black).
// Overlays drive it declaratively through attributes on <html>:
//   data-system-bars="dark" | "light"  → force a tone (e.g. the black photo viewer)
//   data-immersive="true"              → hide the system bars (app only)
import { useEffect } from "react";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { isNativeApp } from "@/lib/native/platform";
import { applyAppearance, currentBgColor, getAppearance, resolvedTheme, subscribeAppearance } from "@/lib/ui/appearance";

const OVERLAY_COLOR = "#000000";

export default function SystemBarsSync() {
  useEffect(() => {
    const root = document.documentElement;
    const native = isNativeApp();
    let lastStyle: SystemBarsStyle | null = null;
    let lastHidden: boolean | null = null;

    const apply = () => {
      const override = root.dataset.systemBars;
      const forced = override === "dark" || override === "light" ? override : null;
      const tone = forced ?? resolvedTheme();

      const color = forced === "dark" ? OVERLAY_COLOR : forced === "light" ? "#f6f7f9" : currentBgColor();
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

    // Follows the OS (under "system") and other tabs' choices.
    applyAppearance(getAppearance());
    const unsubscribe = subscribeAppearance(() => apply());

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-black", "data-system-bars", "data-immersive"],
    });
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
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
