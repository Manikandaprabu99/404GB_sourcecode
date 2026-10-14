// Grid <-> viewer link for the shared-element zoom (docs/DESIGN.md "Photos — new experiences" 6).

type Scroller = (mediaId: string) => boolean;

let scroller: Scroller | null = null;

/** The grid registers how to scroll a photo's tile into view (returns whether it could). */
export function registerGridScroller(fn: Scroller): () => void {
  scroller = fn;
  return () => {
    if (scroller === fn) scroller = null;
  };
}

/** Scrolls the grid so the photo's tile is on screen; false when no grid shows it. */
export function revealTile(mediaId: string): boolean {
  return scroller ? scroller(mediaId) : false;
}

/** The grid tile for a photo: the first `[data-media-id]` outside a modal (pickers, the viewer). */
function tileElement(mediaId: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const all = document.querySelectorAll<HTMLElement>(`[data-media-id="${CSS.escape(mediaId)}"]`);
  for (const el of Array.from(all)) {
    if (!el.closest('[aria-modal="true"]')) return el;
  }
  return null;
}

/** The on-screen rectangle of a photo's tile, or null when it isn't rendered or is off screen. */
export function tileRect(mediaId: string): DOMRect | null {
  const el = tileElement(mediaId);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) return null;
  return rect;
}

/** The tile's decoded thumbnail (its URL and natural size), for the zoom's first frame. */
export function tileImage(mediaId: string): { src: string; width: number; height: number } | null {
  const img = tileElement(mediaId)?.querySelector("img");
  if (!img || !img.complete || !img.naturalWidth) return null;
  const src = img.currentSrc || img.src;
  return src ? { src, width: img.naturalWidth, height: img.naturalHeight } : null;
}

/** Hides a tile while its photo flies out of or into it; returns the undo (always call it). */
export function hideTile(mediaId: string): () => void {
  const el = tileElement(mediaId);
  if (!el) return () => {};
  const previous = el.style.visibility;
  el.style.visibility = "hidden";
  return () => {
    el.style.visibility = previous;
  };
}

/** The user asked for less motion: crossfades instead of the zoom. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}
