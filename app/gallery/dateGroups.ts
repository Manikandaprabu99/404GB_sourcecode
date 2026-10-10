import type { MediaIndexEntry } from "@/lib/media";
import { mediaTime } from "@/lib/library/dates";
import type { ZoomLevel } from "@/lib/library/zoom";

export interface DateGroup {
  /** Local calendar day, month or year, e.g. "2026-10-09", "2026-10" or "2026". */
  key: string;
  label: string;
  /** Gallery date of the group's newest item (epoch ms); 0 when unknown. */
  time: number;
  items: MediaIndexEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Today / Yesterday / weekday within the past week / full date. */
export function dayLabel(date: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** "October 2026" */
export function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "Oct 2026", for the timeline scrubber. */
export function shortMonthLabel(time: number): string {
  if (time <= 0) return "Unknown date";
  return new Date(time).toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const GROUPINGS: Record<ZoomLevel, { key: (date: Date) => string; label: (date: Date, now: Date) => string }> = {
  day: {
    key: (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    label: dayLabel,
  },
  month: {
    key: (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    label: (date) => monthLabel(date),
  },
  year: {
    key: (date) => String(date.getFullYear()),
    label: (date) => String(date.getFullYear()),
  },
};

/** Groups items (already sorted newest first) by the day, month or year they were taken. */
export function groupMedia(
  items: readonly MediaIndexEntry[],
  zoom: ZoomLevel = "day",
  now: Date = new Date()
): DateGroup[] {
  const grouping = GROUPINGS[zoom];
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;
  for (const item of items) {
    const time = mediaTime(item);
    const date = new Date(time);
    const key = time > 0 ? grouping.key(date) : "unknown";
    if (!current || current.key !== key) {
      current = { key, label: time > 0 ? grouping.label(date, now) : "Unknown date", time, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

/** Day groups, as the gallery showed before month and year views existed. */
export function groupByDay(items: readonly MediaIndexEntry[], now: Date = new Date()): DateGroup[] {
  return groupMedia(items, "day", now);
}
