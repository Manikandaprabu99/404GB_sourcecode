import type { MediaIndexEntry } from "@/lib/media";

/** The gallery date of an item: when it was taken, falling back to upload time. */
export function mediaTime(entry: Pick<MediaIndexEntry, "takenAt" | "createdAt">): number {
  if (entry.takenAt) {
    const taken = Date.parse(entry.takenAt);
    if (!Number.isNaN(taken)) return taken;
  }
  const created = Date.parse(entry.createdAt);
  return Number.isNaN(created) ? 0 : created;
}

/** Newest first by gallery date; stable for equal dates (upload time, then id). */
export function sortNewestFirst(entries: readonly MediaIndexEntry[]): MediaIndexEntry[] {
  const keyed = entries.map((entry) => ({
    entry,
    time: mediaTime(entry),
    created: Date.parse(entry.createdAt) || 0,
  }));
  keyed.sort(
    (a, b) =>
      b.time - a.time ||
      b.created - a.created ||
      (a.entry.id < b.entry.id ? 1 : a.entry.id > b.entry.id ? -1 : 0)
  );
  return keyed.map((k) => k.entry);
}

export function formatRelativeTime(epochMs: number, now: number = Date.now()): string {
  const diffSec = Math.round((epochMs - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "just now";
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(epochMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(epochMs).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric",
  });
}
