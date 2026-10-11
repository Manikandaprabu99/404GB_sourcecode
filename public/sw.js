// 404GB service worker.
//
// Strategies (first match wins):
//   /stream/media/<id>      Byte-range video streaming assembled from the stored chunks
//                           (each verified against its SHA-256 before it is served).
//   /api/media/chunk/<hash> Cache-first from the same verified chunk cache.
//   /api/media/thumb/*      Stale-while-revalidate.
//   any other /api/*        Untouched: straight to the network, never cached.
//   navigations             Network-first (with navigation preload), then cached page, then offline.html.
//   /_next/static/*         Cache-first (content-hashed by Next.js).
//   precached shell files   Cache-first.

// Keep in sync with SW_VERSION in lib/media/stream.ts (the page registers /sw.js?v=<version>).
const SW_VERSION = 2;

const SHELL_CACHE = `404gb-shell-v${SW_VERSION}`;
const STATIC_ASSET_CACHE = `404gb-static-v${SW_VERSION}`;
// Content-stable caches keep their names across releases so a deploy doesn't re-download them.
const THUMB_CACHE = "404gb-thumbs-v1";
const CHUNK_CACHE = "404gb-chunks-v1";
const RECORD_CACHE = "404gb-records-v1";
const KNOWN_CACHES = new Set([SHELL_CACHE, STATIC_ASSET_CACHE, THUMB_CACHE, CHUNK_CACHE, RECORD_CACHE]);
const USER_DATA_CACHES = [THUMB_CACHE, CHUNK_CACHE, RECORD_CACHE];

const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  "/",
  "/manifest.json",
  OFFLINE_URL,
  "/favicon.ico",
  "/icons/brand.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

const STREAM_PREFIX = "/stream/media/";
const CHUNK_API_PREFIX = "/api/media/chunk/";
const RECORD_KEY_PREFIX = "/__404gb__/record/";
const LOGOUT_PATH = "/api/auth/logout";

const MiB = 1024 * 1024;
const CHUNK_CACHE_MAX_BYTES = 300 * MiB;
const RECORD_CACHE_MAX_ENTRIES = 500;
const THUMB_CACHE_MAX_ENTRIES = 5000;
const STATIC_CACHE_MAX_ENTRIES = 400;
const SHELL_CACHE_MAX_ENTRIES = 60;
const MEMORY_CHUNK_SLOTS = 4;
const MEMORY_RECORD_SLOTS = 200;
// An open-ended range ("bytes=N-") is answered with the rest of N's chunk, plus the next
// chunk when that remainder is tiny, so each response finishes quickly and playback starts fast.
const OPEN_RANGE_MIN_BYTES = MiB;
const READ_AHEAD_CHUNKS = 3;
const PREFETCH_CONCURRENCY = 3;
const CHUNK_FETCH_ATTEMPTS = 3;
const TRIM_INTERVAL_MS = 30_000;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Per-URL rather than cache.addAll(): one missing asset must not abort the whole install.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: "no-cache" });
            if (res && res.ok) await cache.put(url, res);
          } catch {
            // Offline install: runtime caching fills these in later.
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
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Optional speed-up only.
        }
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "404gb:sw-info") {
    const reply = { type: "404gb:sw-info", version: SW_VERSION, features: ["stream"] };
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
  } else if (data.type === "404gb:purge-user-data") {
    event.waitUntil(purgeUserData());
  }
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === LOGOUT_PATH) {
    // Signing out must not leave the previous account's photos readable from this device.
    // ?keep=repo is the same person's ended sign-in (they sign straight back in): keep the cache.
    if (url.searchParams.get("keep") !== "repo") event.waitUntil(purgeUserData());
    return;
  }

  if (url.pathname.startsWith(STREAM_PREFIX)) {
    if (request.method === "GET" || request.method === "HEAD") {
      event.respondWith(handleStream(event, url));
    }
    return;
  }

  if (request.method !== "GET") return;

  // With navigation preload on, every navigation must be answered from preloadResponse,
  // otherwise the browser sends it twice (fatal for one-shot URLs like the OAuth callback).
  if (request.mode === "navigate") {
    event.respondWith(
      url.pathname.startsWith("/api/") ? passthroughNavigation(event) : networkFirstNavigation(event)
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    const hash = chunkHashFromPath(url.pathname);
    if (hash && !request.headers.has("range")) {
      event.respondWith(serveChunkApi(event, hash));
    } else if (url.pathname.startsWith("/api/media/thumb/")) {
      event.respondWith(staleWhileRevalidate(event, THUMB_CACHE, THUMB_CACHE_MAX_ENTRIES));
    }
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event, STATIC_ASSET_CACHE, STATIC_CACHE_MAX_ENTRIES));
    return;
  }

  if (!url.search && !request.headers.has("rsc") && PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(cacheFirst(event, SHELL_CACHE, SHELL_CACHE_MAX_ENTRIES));
  }
});

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html"))
  );
}

function chunkHashFromPath(pathname) {
  if (!pathname.startsWith(CHUNK_API_PREFIX)) return null;
  const hash = pathname.slice(CHUNK_API_PREFIX.length);
  return HEX_SHA256.test(hash) ? hash : null;
}

// ---------------------------------------------------------------------------
// App shell strategies
// ---------------------------------------------------------------------------

async function passthroughNavigation(event) {
  const preloaded = await event.preloadResponse;
  return preloaded || fetch(event.request);
}

async function networkFirstNavigation(event) {
  const { request } = event;
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preloaded = await event.preloadResponse;
    const fresh = preloaded || (await fetch(request));
    if (fresh && fresh.ok) {
      event.waitUntil(
        cache
          .put(request, fresh.clone())
          .then(() => maybeTrim(SHELL_CACHE, SHELL_CACHE_MAX_ENTRIES))
          .catch(() => {})
      );
    }
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

async function cacheFirst(event, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const fresh = await fetch(event.request);
  if (fresh && fresh.ok) {
    event.waitUntil(
      cache
        .put(event.request, fresh.clone())
        .then(() => maybeTrim(cacheName, maxEntries))
        .catch(() => {})
    );
  }
  return fresh;
}

async function staleWhileRevalidate(event, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (res) => {
      if (res && res.ok) {
        await cache.put(event.request, res.clone());
        await maybeTrim(cacheName, maxEntries);
      }
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  return fresh || new Response(null, { status: 504, statusText: "Offline" });
}

const lastTrimAt = new Map();

/** FIFO entry-count cap, throttled so busy caches aren't re-listed on every write. */
async function maybeTrim(cacheName, maxEntries) {
  const now = Date.now();
  if (now - (lastTrimAt.get(cacheName) || 0) < TRIM_INTERVAL_MS) return;
  lastTrimAt.set(cacheName, now);
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  let excess = keys.length - maxEntries;
  for (const request of keys) {
    if (excess <= 0) break;
    if (cacheName === SHELL_CACHE && PRECACHE_URLS.includes(new URL(request.url).pathname)) continue;
    await cache.delete(request);
    excess -= 1;
  }
}

// ---------------------------------------------------------------------------
// Errors and small helpers
// ---------------------------------------------------------------------------

function httpError(status, message, fatal = false) {
  const err = new Error(message);
  err.status = status;
  err.fatal = fatal;
  return err;
}

function errorResponse(err) {
  const status = err && err.status >= 400 && err.status <= 599 ? err.status : 503;
  const message = (err && err.message) || "Streaming failed";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function readErrorMessage(res) {
  try {
    const body = await res.clone().json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON.
  }
  return `Request failed (${res.status})`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let hex = "";
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}

function normalizeChunkHash(hash) {
  const hex = String(hash || "").replace(/^sha256:/i, "").toLowerCase();
  if (!HEX_SHA256.test(hex)) throw httpError(500, "Media record has an invalid chunk hash", true);
  return hex;
}

function chunkKey(hash) {
  return `${self.location.origin}${CHUNK_API_PREFIX}${hash}`;
}

function recordKey(id) {
  return `${self.location.origin}${RECORD_KEY_PREFIX}${encodeURIComponent(id)}`;
}

function touch(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

// Bumped on sign-out so fetches that were already in flight don't refill the purged caches.
let dataGeneration = 0;

async function purgeUserData() {
  dataGeneration += 1;
  memoryChunks.clear();
  memoryRecords.clear();
  pendingChunkWrites.clear();
  chunkIndexPromise = null;
  await Promise.all(USER_DATA_CACHES.map((name) => caches.delete(name)));
}

// ---------------------------------------------------------------------------
// Media records (GET /api/media/:id) — immutable per id, so cached indefinitely
// ---------------------------------------------------------------------------

const memoryRecords = new Map();
const recordRequests = new Map();

function getRecord(id) {
  const remembered = memoryRecords.get(id);
  if (remembered) return Promise.resolve(remembered);
  let pending = recordRequests.get(id);
  if (!pending) {
    pending = loadRecord(id).finally(() => recordRequests.delete(id));
    recordRequests.set(id, pending);
  }
  return pending;
}

async function loadRecord(id) {
  const generation = dataGeneration;
  const cache = await caches.open(RECORD_CACHE);
  const cached = await cache.match(recordKey(id));
  if (cached) {
    try {
      const record = validateRecord(await cached.json());
      touch(memoryRecords, id, record, MEMORY_RECORD_SLOTS);
      return record;
    } catch {
      await cache.delete(recordKey(id));
    }
  }

  let res;
  try {
    res = await fetch(`/api/media/${encodeURIComponent(id)}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw httpError(503, "Network unavailable");
  }
  if (!res.ok) throw httpError(res.status, await readErrorMessage(res), true);
  const body = await res.json().catch(() => null);
  const media = body && body.media;
  const record = validateRecord(media);

  if (generation === dataGeneration) {
    touch(memoryRecords, id, record, MEMORY_RECORD_SLOTS);
    try {
      await cache.put(
        recordKey(id),
        new Response(JSON.stringify(media), { headers: { "Content-Type": "application/json" } })
      );
      await maybeTrim(RECORD_CACHE, RECORD_CACHE_MAX_ENTRIES);
    } catch {
      // Quota: the record is still remembered in memory.
    }
  }
  return record;
}

/** Keeps only what streaming needs and checks the chunk list really covers the file. */
function validateRecord(media) {
  if (!media || typeof media !== "object") throw httpError(502, "Malformed media record", true);
  const size = Number(media.size);
  if (!Number.isFinite(size) || size < 0 || !Array.isArray(media.chunks)) {
    throw httpError(502, "Malformed media record", true);
  }
  const ordered = media.chunks
    .map((chunk, position) => ({
      index: Number.isFinite(Number(chunk && chunk.index)) ? Number(chunk.index) : position,
      hash: normalizeChunkHash(chunk && chunk.hash),
    }))
    .sort((a, b) => a.index - b.index);
  let chunkSize = Number(media.chunkSize);
  if (ordered.length === 1 && !(chunkSize >= size)) chunkSize = size;
  if (size > 0) {
    if (!(chunkSize > 0) || Math.ceil(size / chunkSize) !== ordered.length) {
      throw httpError(502, "Media record's chunk list doesn't match its size", true);
    }
  }
  return {
    id: String(media.id || ""),
    filename: typeof media.filename === "string" ? media.filename : "",
    mimeType: typeof media.mimeType === "string" && media.mimeType ? media.mimeType : "application/octet-stream",
    hash: typeof media.hash === "string" ? media.hash : "",
    size,
    chunkSize: chunkSize > 0 ? chunkSize : 1,
    chunks: ordered.map((chunk) => chunk.hash),
  };
}

function chunkLength(record, index) {
  return index === record.chunks.length - 1 ? record.size - index * record.chunkSize : record.chunkSize;
}

function chunkIndexAt(record, offset) {
  return Math.min(record.chunks.length - 1, Math.floor(offset / record.chunkSize));
}

// ---------------------------------------------------------------------------
// Verified chunks: memory LRU -> in-flight dedupe -> Cache Storage -> network
// ---------------------------------------------------------------------------

const memoryChunks = new Map();
const chunkRequests = new Map();

async function getChunk(record, index, keepInMemory) {
  const hash = record.chunks[index];
  const remembered = memoryChunks.get(hash);
  if (remembered) {
    touch(memoryChunks, hash, remembered, MEMORY_CHUNK_SLOTS);
    return remembered;
  }
  let pending = chunkRequests.get(hash);
  if (!pending) {
    pending = loadChunk(hash, chunkLength(record, index)).finally(() => chunkRequests.delete(hash));
    chunkRequests.set(hash, pending);
  }
  const bytes = await pending;
  if (keepInMemory) touch(memoryChunks, hash, bytes, MEMORY_CHUNK_SLOTS);
  return bytes;
}

async function loadChunk(hash, expectedLength) {
  const cached = pendingChunkWrites.get(hash) || (await readCachedChunk(hash));
  if (cached && cached.byteLength === expectedLength) return cached;
  const generation = dataGeneration;
  const bytes = await fetchVerifiedChunk(hash);
  if (bytes.byteLength !== expectedLength) {
    throw httpError(502, "Chunk length doesn't match the media record", true);
  }
  if (generation === dataGeneration) storeChunk(hash, bytes);
  return bytes;
}

async function fetchVerifiedChunk(hash) {
  let lastError;
  for (let attempt = 1; attempt <= CHUNK_FETCH_ATTEMPTS; attempt++) {
    try {
      let res;
      try {
        // no-store: Cache Storage below is the chunk cache; don't duplicate 4 MiB bodies in the HTTP cache.
        res = await fetch(chunkKey(hash), { cache: "no-store", credentials: "same-origin" });
      } catch {
        throw httpError(503, "Network unavailable");
      }
      if (!res.ok) {
        const retryable = res.status >= 500 || res.status === 429;
        throw httpError(res.status, await readErrorMessage(res), !retryable);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if ((await sha256Hex(bytes)) !== hash) throw httpError(502, "Chunk failed its integrity check");
      return bytes;
    } catch (err) {
      lastError = err;
      if (err && err.fatal) throw err;
      if (attempt < CHUNK_FETCH_ATTEMPTS) await delay(400 * attempt * attempt);
    }
  }
  throw lastError;
}

async function readCachedChunk(hash) {
  try {
    const cache = await caches.open(CHUNK_CACHE);
    const res = await cache.match(chunkKey(hash));
    return res ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

// Insertion-ordered url -> byte size of everything in CHUNK_CACHE, built lazily once per worker.
let chunkIndexPromise = null;

function loadChunkIndex() {
  if (!chunkIndexPromise) {
    chunkIndexPromise = (async () => {
      const cache = await caches.open(CHUNK_CACHE);
      const entries = new Map();
      let total = 0;
      for (const request of await cache.keys()) {
        const res = await cache.match(request);
        const size = res ? Number(res.headers.get("Content-Length")) || 0 : 0;
        entries.set(request.url, size);
        total += size;
      }
      return { entries, total };
    })().catch((err) => {
      chunkIndexPromise = null;
      throw err;
    });
  }
  return chunkIndexPromise;
}

let chunkWrites = Promise.resolve();
// Chunks queued for Cache Storage stay readable here until their write lands.
const pendingChunkWrites = new Map();

/** Serialized so the running byte total stays exact; evicts the oldest chunks past the cap. */
function storeChunk(hash, bytes) {
  const generation = dataGeneration;
  pendingChunkWrites.set(hash, bytes);
  chunkWrites = chunkWrites
    .then(async () => {
      if (generation !== dataGeneration) return;
      const cache = await caches.open(CHUNK_CACHE);
      const index = await loadChunkIndex();
      const key = chunkKey(hash);
      if (index.entries.has(key)) return;
      const response = () =>
        new Response(bytes, {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(bytes.byteLength),
          },
        });
      try {
        await cache.put(key, response());
      } catch {
        // Likely over quota: free the older half of the cache and try once more.
        await evictOldestChunks(cache, index, index.total / 2);
        try {
          await cache.put(key, response());
        } catch {
          return;
        }
      }
      index.entries.set(key, bytes.byteLength);
      index.total += bytes.byteLength;
      await evictOldestChunks(cache, index, CHUNK_CACHE_MAX_BYTES);
    })
    .catch(() => {})
    .finally(() => {
      if (pendingChunkWrites.get(hash) === bytes) pendingChunkWrites.delete(hash);
    });
  return chunkWrites;
}

async function evictOldestChunks(cache, index, maxBytes) {
  for (const [key, size] of index.entries) {
    if (index.total <= maxBytes || index.entries.size <= 1) break;
    index.entries.delete(key);
    index.total -= size;
    await cache.delete(key);
  }
}

async function cacheChunkFromResponse(hash, response) {
  try {
    const generation = dataGeneration;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if ((await sha256Hex(bytes)) !== hash || generation !== dataGeneration) return;
    await storeChunk(hash, bytes);
  } catch {
    // Caching is best-effort.
  }
}

/** Page-initiated chunk fetches (full-resolution photo loads) share the verified cache. */
async function serveChunkApi(event, hash) {
  const pending = pendingChunkWrites.get(hash);
  if (pending) {
    return new Response(pending, {
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(pending.byteLength) },
    });
  }
  const cache = await caches.open(CHUNK_CACHE);
  const cached = await cache.match(chunkKey(hash));
  if (cached) return cached;
  const fresh = await fetch(new Request(event.request, { cache: "no-store" }));
  if (fresh.ok) event.waitUntil(cacheChunkFromResponse(hash, fresh.clone()));
  return fresh;
}

// ---------------------------------------------------------------------------
// Read-ahead for video playback
// ---------------------------------------------------------------------------

let prefetchActive = 0;
const prefetchQueue = [];

function runPrefetch(task) {
  return new Promise((resolve) => {
    const start = () => {
      prefetchActive += 1;
      task()
        .catch(() => {})
        .finally(() => {
          prefetchActive -= 1;
          const next = prefetchQueue.shift();
          if (next) next();
          resolve();
        });
    };
    if (prefetchActive < PREFETCH_CONCURRENCY) start();
    else prefetchQueue.push(start);
  });
}

async function prefetchChunk(record, index) {
  const hash = record.chunks[index];
  if (memoryChunks.has(hash) || chunkRequests.has(hash) || pendingChunkWrites.has(hash)) return;
  const cachedIndex = await loadChunkIndex().catch(() => null);
  if (cachedIndex && cachedIndex.entries.has(chunkKey(hash))) return;
  await runPrefetch(() => getChunk(record, index, false));
}

/** Warms the next few chunks, and on the first request the last chunk too, where
 * non-faststart MP4/MOV files keep the index the player needs before it can start. */
function readAhead(record, lastServedIndex, includeTail) {
  const wanted = [];
  const lastIndex = record.chunks.length - 1;
  for (let i = lastServedIndex + 1; i <= Math.min(lastIndex, lastServedIndex + READ_AHEAD_CHUNKS); i++) {
    wanted.push(i);
  }
  if (includeTail && lastIndex > lastServedIndex + READ_AHEAD_CHUNKS) wanted.push(lastIndex);
  return Promise.all(wanted.map((i) => prefetchChunk(record, i).catch(() => {})));
}

// ---------------------------------------------------------------------------
// /stream/media/<id>
// ---------------------------------------------------------------------------

/** Parses a single "bytes=" range; null means "ignore the header" (malformed or another unit). */
function parseRange(header, size) {
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*(?:,.*)?$/i.exec(header);
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!(suffix > 0) || size === 0) return { unsatisfiable: true };
    return { start: Math.max(0, size - suffix), end: size - 1, openEnded: false };
  }
  const start = Number(rawStart);
  if (rawEnd !== "" && Number(rawEnd) < start) return null;
  if (start >= size) return { unsatisfiable: true };
  if (rawEnd === "") return { start, end: size - 1, openEnded: true };
  return { start, end: Math.min(Number(rawEnd), size - 1), openEnded: false };
}

function openRangeEnd(record, start) {
  const index = chunkIndexAt(record, start);
  let end = Math.min(record.size, (index + 1) * record.chunkSize) - 1;
  if (end - start + 1 < OPEN_RANGE_MIN_BYTES && index + 1 < record.chunks.length) {
    end = Math.min(record.size, (index + 2) * record.chunkSize) - 1;
  }
  return end;
}

function streamHeaders(record, length) {
  const headers = new Headers({
    "Content-Type": record.mimeType,
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  });
  if (record.hash) headers.set("ETag", `"${record.hash.replace(/^sha256:/, "")}"`);
  if (record.filename) {
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
  }
  return headers;
}

function createRangeStream(record, start, end, firstIndex, firstBytes, readsAhead) {
  let index = firstIndex;
  let position = start;
  let inHand = firstBytes;
  return new ReadableStream({
    async pull(controller) {
      try {
        // Long ranges (Safari asks for whole files) keep the read-ahead window moving as they're consumed.
        if (readsAhead && index > firstIndex) readAhead(record, index, false);
        const bytes = inHand || (await getChunk(record, index, true));
        inHand = null;
        const chunkStart = index * record.chunkSize;
        const from = position - chunkStart;
        const to = Math.min(bytes.byteLength, end - chunkStart + 1);
        // A copy: the cached buffer stays reusable whatever the consumer does with this one.
        controller.enqueue(bytes.slice(from, to));
        position = chunkStart + to;
        index += 1;
        if (position > end) controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

async function handleStream(event, url) {
  let id;
  try {
    id = decodeURIComponent(url.pathname.slice(STREAM_PREFIX.length));
  } catch {
    id = "";
  }
  if (!id || id.includes("/")) return errorResponse(httpError(404, "Not found"));

  let record;
  try {
    record = await getRecord(id);
  } catch (err) {
    return errorResponse(err);
  }

  const { request } = event;
  const size = record.size;
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;

  if (range && range.unsatisfiable) {
    return new Response(null, {
      status: 416,
      statusText: "Range Not Satisfiable",
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  let start = 0;
  let end = size - 1;
  if (range) {
    start = range.start;
    end = range.openEnded ? openRangeEnd(record, start) : range.end;
  }
  const length = Math.max(0, end - start + 1);
  const headers = streamHeaders(record, length);
  const status = range ? 206 : 200;
  const statusText = range ? "Partial Content" : "OK";
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  if (request.method === "HEAD" || length === 0) {
    return new Response(null, { status, statusText, headers });
  }

  // The first chunk is awaited before answering so failures surface as a real status code.
  const firstIndex = chunkIndexAt(record, start);
  let firstBytes;
  try {
    firstBytes = await getChunk(record, firstIndex, true);
  } catch (err) {
    return errorResponse(err);
  }

  const readsAhead = /^(video|audio)\//.test(record.mimeType) && record.chunks.length > 1;
  if (readsAhead) event.waitUntil(readAhead(record, chunkIndexAt(record, end), start === 0));

  return new Response(createRangeStream(record, start, end, firstIndex, firstBytes, readsAhead), {
    status,
    statusText,
    headers,
  });
}
