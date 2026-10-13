/** Service worker generation this build registers; must match SW_VERSION in public/sw.js. */
export const SW_VERSION = 4;
/** Versioned so the controlling worker's scriptURL alone shows (synchronously) that it can stream. */
export const SW_SCRIPT_URL = `/sw.js?v=${SW_VERSION}`;

// Shared with public/sw.js (keep in sync): the worker's verified-chunk cache, which the
// page reads before downloading an original and fills through STORE_CHUNK_MESSAGE.
export const CHUNK_CACHE = "404gb-chunks-v2";
export const CHUNK_KEY_PREFIX = "/__404gb__/chunk/";
export const STORE_CHUNK_MESSAGE = "404gb:store-chunk";
export const PURGE_MESSAGE = "404gb:purge-user-data";

// v3 is the first worker that reads from GitHub directly; older ones streamed through /api.
const STREAMING_SINCE_VERSION = 3;
const HANDSHAKE_TIMEOUT_MS = 4000;

/** URL a <video> element can play while the file is still downloading. The
 * service worker (public/sw.js) answers it with byte ranges assembled from the
 * stored chunks, so playback and seeking start without fetching the whole file. */
export function streamUrl(mediaId: string): string {
  return `/stream/media/${encodeURIComponent(mediaId)}`;
}

interface Verdict {
  worker: ServiceWorker;
  supported: boolean;
}

let verdict: Verdict | null = null;
let probing: ServiceWorker | null = null;
let watching = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function scriptVersion(scriptURL: string): number {
  try {
    return Number(new URL(scriptURL).searchParams.get("v")) || 0;
  } catch {
    return 0;
  }
}

/** Asks the worker what it supports; the answer replaces the scriptURL guess. */
function probe(worker: ServiceWorker): void {
  if (probing === worker || verdict?.worker === worker) return;
  probing = worker;
  const channel = new MessageChannel();
  const settle = (supported: boolean | null) => {
    window.clearTimeout(timer);
    channel.port1.close();
    if (probing === worker) probing = null;
    // A timeout (cold worker) keeps the scriptURL guess and lets a later call probe again.
    if (supported === null) return;
    verdict = { worker, supported };
    notify();
  };
  const timer = window.setTimeout(() => settle(null), HANDSHAKE_TIMEOUT_MS);
  channel.port1.onmessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown; version?: unknown; features?: unknown } | null;
    settle(
      data?.type === "404gb:sw-info" &&
        Number(data.version) >= STREAMING_SINCE_VERSION &&
        Array.isArray(data.features) &&
        data.features.includes("stream")
    );
  };
  try {
    worker.postMessage({ type: "404gb:sw-info" }, [channel.port2]);
  } catch {
    settle(false);
  }
}

function watch(): void {
  if (watching) return;
  watching = true;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const controller = navigator.serviceWorker.controller;
    if (controller) probe(controller);
    notify();
  });
}

function hasServiceWorkers(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

/** True when a streaming-capable service worker controls this page. Synchronous and
 * cheap, so it's safe to call during render; it is false during prerendering, in dev
 * builds, after a hard reload, and on a first visit until the worker takes over. */
export function canStream(): boolean {
  if (!hasServiceWorkers()) return false;
  watch();
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  if (verdict?.worker === controller) return verdict.supported;
  probe(controller);
  return scriptVersion(controller.scriptURL) >= STREAMING_SINCE_VERSION;
}

/** Notifies when canStream() may have changed (a worker took control or answered the
 * handshake). Pair with React's useSyncExternalStore(subscribeStreamSupport, canStream, () => false). */
export function subscribeStreamSupport(listener: () => void): () => void {
  if (hasServiceWorkers()) watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Posts a message to the controlling service worker, if any (best effort). */
export function postToServiceWorker(message: unknown, transfer?: Transferable[]): boolean {
  if (!hasServiceWorkers()) return false;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return false;
  try {
    controller.postMessage(message, transfer ?? []);
    return true;
  } catch {
    return false;
  }
}
