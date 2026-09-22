// 404GB service worker (Phase 5 — PWA).
//
// Scope: everything reachable at "/", since this file is served from the
// public root (see next.config.mjs headers for /sw.js).
//
// Strategy summary:
//   - App shell ("/", manifest, icons, offline fallback) — precached on
//     install, served network-first at runtime (always prefer a fresh
//     response; fall back to the cached copy, then to offline.html).
//   - Next.js build output under /_next/static/ — cache-first. These URLs
//     are content-hashed by Next.js, so a cached response is never stale;
//     a new deploy simply requests different hashed URLs.
//   - Thumbnails (/api/media/thumb/*) — stale-while-revalidate, so the
//     gallery grid paints instantly from cache while a fresh copy is
//     fetched in the background.
//   - Everything else (auth, upload, media index/object/repos APIs) is
//     intentionally left untouched — the fetch handler simply does not
//     call event.respondWith(), so the browser handles those requests
//     exactly as if there were no service worker at all. This matters for
//     anything that reads/mutates session state (auth, upload) or is
//     already served fresh-by-design via lib/cache's own SHA-based sync
//     (media index/object), which the SW must not shadow with stale data.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `404gb-shell-${CACHE_VERSION}`;
const STATIC_ASSET_CACHE = `404gb-static-${CACHE_VERSION}`;
const THUMB_CACHE = `404gb-thumbs-${CACHE_VERSION}`;
const KNOWN_CACHES = new Set([SHELL_CACHE, STATIC_ASSET_CACHE, THUMB_CACHE]);

const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Paths that must never be touched by the service worker — always go
// straight to the network with no caching involved, per Phase 5 spec.
const NETWORK_ONLY_PREFIXES = ["/api/auth/", "/api/media/upload/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache each URL independently — one missing/failed asset (e.g. an
      // icon not yet built) shouldn't abort the whole precache the way
      // cache.addAll() would.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res && res.ok) await cache.put(url, res);
          } catch {
            // Best-effort precache; offline install (first load with no
            // network) simply skips it and runtime caching fills in later.
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("404gb-") && !KNOWN_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && request.headers.get("accept")?.includes("text/html"))
  );
}

function isNextStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isThumbnailRequest(url) {
  return url.pathname.startsWith("/api/media/thumb/");
}

function isNetworkOnly(url) {
  return NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isPrecachedShellAsset(url) {
  return PRECACHE_URLS.includes(url.pathname);
}

/** Network-first: try the network, cache a copy of what comes back, and
 * fall back to cache (then the offline shell) if the network fails. Used
 * for navigations so the user always sees fresh content when online, but
 * still gets *something* offline. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response("Offline", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/** Cache-first: for content-addressed/hashed assets that never change
 * shape once built, so there's no reason to hit the network twice. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone()).catch(() => {});
  return fresh;
}

/** Stale-while-revalidate: return the cached response immediately (if any)
 * for instant paint, while a background fetch refreshes the cache for next
 * time. Used for thumbnails, which are small, numerous, and rarely change
 * once generated for a given media id/size. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const fresh = await networkFetch;
  return fresh ?? new Response(null, { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept mutations
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // same-origin only

  if (isNetworkOnly(url)) return; // let the browser handle it untouched

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (isThumbnailRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, THUMB_CACHE));
    return;
  }

  if (isNextStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_ASSET_CACHE));
    return;
  }

  if (isPrecachedShellAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Everything else (media index/object/[id] APIs, /api/repos, etc.) is
  // intentionally left alone — no respondWith() means normal network
  // fetch, no service-worker caching layer involved.
});
