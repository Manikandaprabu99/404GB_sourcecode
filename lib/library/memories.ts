// "On this day" memories (capture date, ±1 day, one per earlier year) and the Photos hero's
// Spotlight cards. Pure, for plain node tests.

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

// Spotlight cards: On this day, This week, Recent highlights, With <person>; else one "Recent".
// `items` is what the story plays and the viewer pages through (newest first, capped).

export type SpotlightKind = "on-this-day" | "week" | "highlights" | "person" | "recent";

export interface Spotlight {
  /** Stable across renders: "1y", "week", "highlights", "person:<id>", "recent". */
  key: string;
  kind: SpotlightKind;
  /** "On this day", "This week", "Recent highlights", "With Alex", "Recent". */
  title: string;
  /** "3 years ago · 13 Oct 2023", "24 photos · Oct 7 – 13". */
  subtitle: string;
  /** The card's accessible name, e.g. "On this day, 1 year ago, 2 items". */
  label: string;
  items: MediaIndexEntry[];
  cover: MediaIndexEntry;
}

/** A person, as Spotlight needs one (lib/faces/people's Person fits). */
export interface SpotlightPerson {
  id: string;
  name: string | null;
  mediaIds: readonly string[];
}

export const SPOTLIGHT_MAX_ITEMS = 30;
const WEEK_MIN_ITEMS = 4;
const HIGHLIGHTS_MIN_ITEMS = 4;
const PERSON_MIN_ITEMS = 6;

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${count.toLocaleString()} items`;
}

/** Up to `max` items spread evenly over `items` (order kept). */
export function spreadPick<T>(items: readonly T[], max = SPOTLIGHT_MAX_ITEMS): T[] {
  if (items.length <= max) return items.slice();
  const out: T[] = [];
  const step = items.length / max;
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * step)]);
  return out;
}

function takenTime(item: MediaIndexEntry): number {
  const time = Date.parse(item.takenAt ?? item.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

function shortDay(time: number): string {
  const date = new Date(time);
  return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: "short" })} ${date.getFullYear()}`;
}

function photosFact(items: readonly MediaIndexEntry[]): string {
  let videos = 0;
  for (const item of items) if (item.mimeType.startsWith("video/")) videos += 1;
  const photos = items.length - videos;
  const parts: string[] = [];
  if (photos > 0) parts.push(photos === 1 ? "1 photo" : `${photos.toLocaleString()} photos`);
  if (videos > 0) parts.push(videos === 1 ? "1 video" : `${videos.toLocaleString()} videos`);
  return parts.join(" · ");
}

/** The hero's cards for `now`. `items` newest first; `people` optional (named ones only are used). */
export function spotlight(
  items: readonly MediaIndexEntry[],
  now: Date = new Date(),
  people: readonly SpotlightPerson[] = []
): Spotlight[] {
  if (items.length === 0) return [];
  const out: Spotlight[] = [];

  for (const memory of onThisDay(items, now)) {
    const picked = spreadPick(memory.items);
    out.push({
      key: memory.key,
      kind: "on-this-day",
      title: "On this day",
      subtitle: `${memory.label} · ${shortDay(takenTime(memory.items[0]))}`,
      label: `On this day, ${memory.label}, ${countLabel(memory.items.length)}`,
      items: picked,
      cover: memory.cover,
    });
  }

  const today = startOfDay(now);
  const weekStart = today - 6 * DAY_MS;
  const week = items.filter((item) => {
    const time = takenTime(item);
    return time >= weekStart && time < today + DAY_MS;
  });
  if (week.length >= WEEK_MIN_ITEMS) {
    out.push({
      key: "week",
      kind: "week",
      title: "This week",
      subtitle: photosFact(week),
      label: `This week, ${countLabel(week.length)}`,
      items: spreadPick(week),
      cover: pickCover(week),
    });
  }

  // Favorites from the last three months, else a spread of the last month.
  const quarter = today - 90 * DAY_MS;
  const recentFavorites = items.filter((item) => item.favorite && takenTime(item) >= quarter);
  const lastMonth = items.filter((item) => takenTime(item) >= today - 30 * DAY_MS && takenTime(item) < weekStart);
  const highlights = recentFavorites.length >= HIGHLIGHTS_MIN_ITEMS ? recentFavorites : lastMonth;
  if (highlights.length >= HIGHLIGHTS_MIN_ITEMS) {
    const picked = spreadPick(highlights, 20);
    out.push({
      key: "highlights",
      kind: "highlights",
      title: "Recent highlights",
      subtitle: photosFact(picked),
      label: `Recent highlights, ${countLabel(picked.length)}`,
      items: picked,
      cover: pickCover(picked),
    });
  }

  const named = people
    .filter((person) => person.name && person.mediaIds.length >= PERSON_MIN_ITEMS)
    .sort((a, b) => b.mediaIds.length - a.mediaIds.length)
    .slice(0, 2);
  if (named.length > 0) {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const person of named) {
      const theirs = person.mediaIds.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item] : [];
      });
      if (theirs.length < PERSON_MIN_ITEMS) continue;
      const picked = spreadPick(theirs, 24);
      out.push({
        key: `person:${person.id}`,
        kind: "person",
        title: `With ${person.name}`,
        subtitle: photosFact(theirs),
        label: `With ${person.name}, ${countLabel(theirs.length)}`,
        items: picked,
        cover: pickCover(picked),
      });
    }
  }

  if (out.length === 0) {
    const recent = items.slice(0, 20);
    out.push({
      key: "recent",
      kind: "recent",
      title: "Recent",
      subtitle: photosFact(recent),
      label: `Recent, ${countLabel(recent.length)}`,
      items: recent,
      cover: pickCover(recent),
    });
  }
  return out;
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
