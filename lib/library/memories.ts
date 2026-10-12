// "On this day": photos taken on today's calendar date (give or take a day) in earlier years,
// one memory per year. Uses the capture date only; an upload date says nothing about the day
// a photo was taken. Pure, for plain node tests.

import type { MediaIndexEntry } from "@/lib/media/types";

export interface Memory {
  /** "1y", "3y": stable across renders. */
  key: string;
  yearsAgo: number;
  /** "1 year ago", "3 years ago". */
  label: string;
  /** Newest first. */
  items: MediaIndexEntry[];
  cover: MediaIndexEntry;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function memoryLabel(yearsAgo: number): string {
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

/** The anniversary within `windowDays` of today, as whole years since the photo; 0 when there is none. */
export function yearsAgoOnThisDay(taken: Date, now: Date, windowDays = 1): number {
  const today = startOfDay(now);
  // Around New Year the nearest anniversary can fall in last or next calendar year.
  for (const year of [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1]) {
    const anniversary = new Date(year, taken.getMonth(), taken.getDate()).getTime();
    // Rounded, so a daylight-saving change between the two dates doesn't matter.
    const days = Math.round((anniversary - today) / DAY_MS);
    if (Math.abs(days) <= windowDays) {
      const years = year - taken.getFullYear();
      return years >= 1 ? years : 0;
    }
  }
  return 0;
}

/** A card's picture: a favorite, else a photo, else anything, preferring ones with thumbnails. */
function pickCover(items: readonly MediaIndexEntry[]): MediaIndexEntry {
  return (
    items.find((item) => item.favorite && item.thumb) ??
    items.find((item) => item.thumb && item.mimeType.startsWith("image/")) ??
    items.find((item) => item.thumb) ??
    items[0]
  );
}

/** Memories for `now`, most recent year first. `items` should be newest first; so is each memory. */
export function onThisDay(items: readonly MediaIndexEntry[], now: Date = new Date(), windowDays = 1): Memory[] {
  const byYears = new Map<number, MediaIndexEntry[]>();
  for (const item of items) {
    if (!item.takenAt) continue;
    const time = Date.parse(item.takenAt);
    if (Number.isNaN(time)) continue;
    const years = yearsAgoOnThisDay(new Date(time), now, windowDays);
    if (years < 1) continue;
    const list = byYears.get(years);
    if (list) list.push(item);
    else byYears.set(years, [item]);
  }
  return Array.from(byYears, ([yearsAgo, list]) => ({
    key: `${yearsAgo}y`,
    yearsAgo,
    label: memoryLabel(yearsAgo),
    items: list,
    cover: pickCover(list),
  })).sort((a, b) => a.yearsAgo - b.yearsAgo);
}
