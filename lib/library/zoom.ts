// How dense the photo grid is, like Google Photos' pinch levels: "day" (big
// tiles, a header per day), "month" and "year" (denser tiles, a header per
// month or year). Shared by every library screen and remembered on this device.

import { useSyncExternalStore } from "react";

export type ZoomLevel = "day" | "month" | "year";

/** From biggest tiles to densest. */
export const ZOOM_LEVELS: readonly ZoomLevel[] = ["day", "month", "year"];

export const ZOOM_LABELS: Record<ZoomLevel, string> = { day: "Day", month: "Month", year: "Year" };

const STORAGE_KEY = "404gb-gallery-zoom";

let zoom: ZoomLevel = "day";
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "month" || saved === "year") zoom = saved;
  } catch {
    // Private mode or blocked storage: start at day view.
  }
}

export function getZoom(): ZoomLevel {
  load();
  return zoom;
}

function getServerZoom(): ZoomLevel {
  return "day";
}

function subscribeZoom(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setZoom(next: ZoomLevel): void {
  load();
  if (next === zoom) return;
  zoom = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Only affects the next visit.
  }
  for (const listener of listeners) listener();
}

/** +1 zooms out (denser: day → month → year), -1 zooms in. Returns false at either end. */
export function stepZoom(direction: 1 | -1): boolean {
  const index = ZOOM_LEVELS.indexOf(getZoom()) + direction;
  if (index < 0 || index >= ZOOM_LEVELS.length) return false;
  setZoom(ZOOM_LEVELS[index]);
  return true;
}

export function useZoom(): ZoomLevel {
  return useSyncExternalStore(subscribeZoom, getZoom, getServerZoom);
}
