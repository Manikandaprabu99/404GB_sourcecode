import type { MediaIndexEntry } from "@/lib/media";

export interface DateGroup {
  label: string;
  items: MediaIndexEntry[];
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function labelFor(date: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (isSameDay(date, now)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** Groups items (already sorted newest-first) into Today/Yesterday/date headers. */
export function groupByDay(items: MediaIndexEntry[]): DateGroup[] {
  const now = new Date();
  const groups: DateGroup[] = [];

  for (const item of items) {
    const date = new Date(item.createdAt);
    const label = labelFor(date, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }

  return groups;
}
