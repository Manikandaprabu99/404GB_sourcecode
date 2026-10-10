export interface Size {
  w: number;
  h: number;
}

export interface Zoom {
  s: number;
  x: number;
  y: number;
}

export const IDENTITY: Zoom = { s: 1, x: 0, y: 0 };

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Largest box with the given aspect ratio (w/h) that fits the stage. Unknown ratios get a square. */
export function fitBox(aspect: number | null | undefined, stageW: number, stageH: number): Size {
  if (stageW <= 0 || stageH <= 0) return { w: 0, h: 0 };
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) {
    const side = Math.min(stageW, stageH);
    return { w: side, h: side };
  }
  return aspect > stageW / stageH ? { w: stageW, h: stageW / aspect } : { w: stageH * aspect, h: stageH };
}

/** iOS-style resistance past an edge: grows ever more slowly, never beyond `dimension`. */
export function rubberBand(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const distance = Math.abs(overshoot);
  return Math.sign(overshoot) * (1 - 1 / ((distance * constant) / dimension + 1)) * dimension;
}

/** How far the zoomed box may move from center before its edge passes the stage edge. */
export function panBounds(box: Size, scale: number, stageW: number, stageH: number): { x: number; y: number } {
  return {
    x: Math.max(0, (box.w * scale - stageW) / 2),
    y: Math.max(0, (box.h * scale - stageH) / 2),
  };
}

export function clampZoom(zoom: Zoom, box: Size, stageW: number, stageH: number): Zoom {
  const bounds = panBounds(box, zoom.s, stageW, stageH);
  return { s: zoom.s, x: clamp(zoom.x, -bounds.x, bounds.x), y: clamp(zoom.y, -bounds.y, bounds.y) };
}

/** Rescales around a focal point (relative to the stage center), keeping that point fixed on screen. */
export function zoomAround(zoom: Zoom, nextScale: number, focalX: number, focalY: number): Zoom {
  const ratio = nextScale / zoom.s;
  return {
    s: nextScale,
    x: focalX - ratio * (focalX - zoom.x),
    y: focalY - ratio * (focalY - zoom.y),
  };
}

export function zoomTransform(zoom: Zoom, layer: boolean): string {
  return layer
    ? `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.s})`
    : `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})`;
}
