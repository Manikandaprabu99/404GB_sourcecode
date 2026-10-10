/** URL a <video> element can play while the file is still downloading. The
 * service worker (public/sw.js) answers it with byte ranges assembled from the
 * stored chunks, so playback and seeking start without fetching the whole file. */
export function streamUrl(mediaId: string): string {
  return `/stream/media/${encodeURIComponent(mediaId)}`;
}

/** Streaming only works once the service worker controls the page. */
export function canStream(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.serviceWorker?.controller);
}
