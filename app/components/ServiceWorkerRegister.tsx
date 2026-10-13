"use client";

// Registers public/sw.js (offline shell, thumbnail cache, video streaming). Mounted
// once from the root layout; renders nothing. Failures never break the page.
import { useEffect } from "react";
import { isRunnerPage } from "@/lib/faces/runnerHost";
import { canStream, SW_SCRIPT_URL } from "@/lib/media/stream";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Production only: next dev's HMR and ever-changing chunk URLs don't mix with a caching worker.
    if (process.env.NODE_ENV !== "production") return;
    // Never from the background People runner (runner/faces.html): it runs headless on its own
    // origin, where a worker would only cache pages nobody opens (docs/FACES.md "Background").
    if (isRunnerPage()) return;

    let registration: ServiceWorkerRegistration | null = null;
    let lastUpdateCheck = Date.now();

    navigator.serviceWorker
      .register(SW_SCRIPT_URL, { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        canStream(); // starts the streaming-support handshake with the controlling worker
      })
      .catch((err) => {
        console.warn("[404gb] service worker registration failed", err);
      });

    // The installed app can stay open for days without a full navigation, which is when
    // browsers normally look for a new worker.
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !registration) return;
      if (Date.now() - lastUpdateCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastUpdateCheck = Date.now();
      registration.update().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
