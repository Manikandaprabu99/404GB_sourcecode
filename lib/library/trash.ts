// Trash rules shared by the store and the screens. Items in Trash keep their index entry (so
// the same file is still recognised as a duplicate) until they're deleted for good, by hand
// or automatically 30 days after they were moved there. Pure, for plain node tests.

import type { MediaIndexEntry } from "@/lib/media/types";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;

/** When it was moved to Trash (epoch ms); 0 when it isn't in Trash or the date is unreadable. */
export function trashedTime(entry: Pick<MediaIndexEntry, "trashedAt">): number {
  if (!entry.trashedAt) return 0;
  const time = Date.parse(entry.trashedAt);
  return Number.isNaN(time) ? 0 : time;
}

/** Whole days until it's deleted for good, rounded up; 0 once it's due. */
export function daysLeftInTrash(entry: Pick<MediaIndexEntry, "trashedAt">, now: number = Date.now()): number {
  const trashed = trashedTime(entry);
  if (!trashed) return TRASH_RETENTION_DAYS;
  return Math.max(0, Math.ceil((trashed + TRASH_RETENTION_MS - now) / DAY_MS));
}

/** Due for deletion (an unreadable date never is: it's kept rather than deleted by mistake). */
export function isTrashExpired(entry: Pick<MediaIndexEntry, "trashedAt">, now: number = Date.now()): boolean {
  const trashed = trashedTime(entry);
  return trashed > 0 && trashed + TRASH_RETENTION_MS <= now;
}

/** "30 days", "1 day", "Today" (it goes with the next cleanup). */
export function daysLeftLabel(days: number): string {
  if (days <= 0) return "Today";
  return days === 1 ? "1 day" : `${days} days`;
}

/** Most recently trashed first; stable for equal times. */
export function sortByTrashedNewest(entries: readonly MediaIndexEntry[]): MediaIndexEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, time: trashedTime(entry) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map((k) => k.entry);
}

/** Local calendar day, "2026-10-11": the automatic cleanup runs at most once per day. */
export function localDayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
