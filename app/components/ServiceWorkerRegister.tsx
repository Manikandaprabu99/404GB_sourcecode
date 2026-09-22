"use client";

// Phase 5 (PWA): registers the hand-written service worker (public/sw.js).
// Mounted once from the root layout. Renders nothing — this is a pure
// side-effect component.
//
// Registration only ever happens in the browser (inside useEffect, which
// never runs during SSR/static generation) and is wrapped so a failure
// (unsupported browser, non-secure context, sw.js 404 in some odd deploy,
// etc.) can never throw and break the rest of the app — PWA install/offline
// support is a progressive enhancement, not a requirement to render.
import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Skip in local `next dev`: Next's dev server rewrites/HMR and
    // constantly-changing chunk URLs don't play well with a caching layer,
    // and it's easy to get "stuck" on a stale cached shell while iterating.
    // Vercel production + preview deployments both run production builds,
    // so this still covers every real deployment.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("[404gb] service worker registration failed", err);
    });
  }, []);

  return null;
}
