import type { MediaIndexEntry } from "@/lib/media";
import { mediaTime } from "@/lib/library/dates";
import type { ZoomLevel } from "@/lib/library/zoom";

export interface DateGroup {
  /** Local calendar day, month or year, e.g. "2026-10-09", "2026-10" or "2026". */
  key: string;
  /** The section's accessible name ("Today", "Sat, Oct 11", "October 2026"). */
  label: string;
  /** What the header shows when it differs from `label` ("Saturday, October 11", "October"). */
  title?: string;
  /** The header's telemetry line, shown uppercase ("Sun 12 Oct · 14", "2026 · 312"); the item
   * count when left out. */
  meta?: string;
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

// One formatter per pattern, made on first use: building an Intl formatter costs far more than
// formatting with it, and a big library has a thousand day groups.
const formatters = new Map<string, Intl.DateTimeFormat>();
function format(date: Date, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
}

/** Today / Yesterday / weekday within the past week / full date. */
export function dayLabel(date: Date, now: Date): string {
  const days = daysAgo(date, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return format(date, { weekday: "long" });
  return format(date, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** A day header: Today / Yesterday / weekday within the past week, else "Saturday, October 11"
 * (the year is in the telemetry line). */
export function dayTitle(date: Date, now: Date): string {
  const days = daysAgo(date, now);
  if (days >= 0 && days < 7) return dayLabel(date, now);
  return format(date, { weekday: "long", month: "long", day: "numeric" });
}

/** "Sun 12 Oct" (+ the year when it isn't this year), for telemetry lines (shown uppercase). */
export function shortDate(date: Date, now: Date = new Date()): string {
  const weekday = format(date, { weekday: "short" });
  const month = format(date, { month: "short" });
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${weekday} ${date.getDate()} ${month}${year}`;
}

/** "October 2026" */
export function monthLabel(date: Date): string {
  return format(date, { month: "long", year: "numeric" });
}

/** "Oct 2026", for the timeline scrubber. */
export function shortMonthLabel(time: number): string {
  if (time <= 0) return "Unknown date";
  return format(new Date(time), { month: "short", year: "numeric" });
}

export function itemCount(count: number): string {
  return count === 1 ? "1 item" : `${count.toLocaleString()} items`;
}

interface Grouping {
  key: (date: Date) => string;
  label: (date: Date, now: Date) => string;
  title?: (date: Date, now: Date) => string;
  meta: (date: Date, count: number, now: Date) => string;
}

const GROUPINGS: Record<ZoomLevel, Grouping> = {
  day: {
    key: (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    label: dayLabel,
    title: dayTitle,
    meta: (date, count, now) => `${shortDate(date, now)} · ${count.toLocaleString()}`,
  },
  month: {
    key: (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    label: (date) => monthLabel(date),
    title: (date) => format(date, { month: "long" }),
    meta: (date, count) => `${date.getFullYear()} · ${count.toLocaleString()}`,
  },
  year: {
    key: (date) => String(date.getFullYear()),
    label: (date) => String(date.getFullYear()),
    meta: (_date, count) => itemCount(count),
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
      current =
        time > 0
          ? { key, label: grouping.label(date, now), title: grouping.title?.(date, now), time, items: [] }
          : { key, label: "Unknown date", time, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  // Counts are known once every item is in.
  for (const group of groups) {
    if (group.time > 0) group.meta = grouping.meta(new Date(group.time), group.items.length, now);
  }
  return groups;
}

/** Day groups, as the gallery showed before month and year views existed. */
export function groupByDay(items: readonly MediaIndexEntry[], now: Date = new Date()): DateGroup[] {
  return groupMedia(items, "day", now);
}
