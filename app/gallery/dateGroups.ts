import type { MediaIndexEntry } from "@/lib/media";
import { mediaTime } from "@/lib/library/dates";

export interface DateGroup {
  /** Local calendar day, e.g. "2026-10-09". */
  key: string;
  label: string;
  items: MediaIndexEntry[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayKeyFor(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
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

/** Groups items (already sorted newest first) by the day they were taken. */
export function groupByDay(items: readonly MediaIndexEntry[], now: Date = new Date()): DateGroup[] {
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;
  for (const item of items) {
    const time = mediaTime(item);
    const date = new Date(time);
    const key = time > 0 ? dayKeyFor(date) : "unknown";
    if (!current || current.key !== key) {
      current = { key, label: time > 0 ? dayLabel(date, now) : "Unknown date", items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}
