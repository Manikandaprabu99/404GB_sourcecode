"use client";

import type { Memory } from "@/lib/library/memories";
import type { ZoomLevel } from "@/lib/library/zoom";
import GalleryThumb from "./GalleryThumb";

interface MemoriesStripProps {
  memories: Memory[];
  repoKey: string;
  zoom: ZoomLevel;
  /** Selecting in the grid: the cards wait. */
  disabled: boolean;
  onOpen: (memory: Memory) => void;
}

// docs/DESIGN.md › Screens › Photos: 148×208 cards (radius 18) in the day view, smaller in the
// month view; the year view is an overview without them.
const CARD: Record<Exclude<ZoomLevel, "year">, string> = {
  day: "h-[208px] w-[148px] rounded-[18px] sm:h-[236px] sm:w-[168px]",
  month: "h-[136px] w-[96px] rounded-[14px]",
};

/** "13 Oct 2023" (shown uppercase), the newest item's capture date. */
function dateLine(memory: Memory): string {
  const taken = memory.items[0]?.takenAt;
  if (!taken) return "";
  const date = new Date(taken);
  return `${date.getDate()} ${date.toLocaleDateString(undefined, { month: "short" })} ${date.getFullYear()}`;
}

/** "On this day": a card per earlier year with photos from today's date (±1 day). */
export default function MemoriesStrip({ memories, repoKey, zoom, disabled, onOpen }: MemoriesStripProps) {
  if (memories.length === 0 || zoom === "year") return null;
  const small = zoom === "month";
  return (
    <section
      aria-label="On this day"
      className={`animate-fade-in pb-3 pt-2 transition-opacity duration-180 ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pb-3 sm:px-6">
        <h2 className="font-display text-[18px] font-semibold leading-tight tracking-[-0.01em] text-ink">On this day</h2>
        <p className="telemetry shrink-0 text-ink-muted">
          {memories.length === 1 ? "1 memory" : `${memories.length} memories`}
        </p>
      </div>
      <ul className="flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:scroll-px-6 sm:gap-3 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {memories.map((memory, i) => {
          const count = memory.items.length;
          const date = dateLine(memory);
          return (
            <li key={memory.key} className="snap-start animate-fade-in-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <button
                type="button"
                data-memory={memory.key}
                disabled={disabled}
                onClick={() => onOpen(memory)}
                aria-label={`${memory.label}, ${count === 1 ? "1 item" : `${count} items`}`}
                className={`group relative block shrink-0 overflow-hidden bg-surface-2 outline-none transition-transform duration-250 ease-out-expo hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.97] ${CARD[small ? "month" : "day"]}`}
              >
                <GalleryThumb
                  repoKey={repoKey}
                  mediaId={memory.cover.id}
                  alt=""
                  size={small ? 320 : 800}
                  hasThumbnail={Boolean(memory.cover.thumb)}
                  isVideo={memory.cover.mimeType.startsWith("video/")}
                  className="h-full w-full object-cover transition-transform duration-320 ease-out-expo group-hover:scale-[1.04]"
                />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                {count > 1 && !small && (
                  <span className="telemetry pointer-events-none absolute right-2 top-2 flex h-[18px] items-center rounded-[5px] bg-black/55 px-1.5 text-[10px] text-white">
                    {count}
                  </span>
                )}
                <span className={`pointer-events-none absolute inset-x-0 bottom-0 text-left text-white ${small ? "p-2" : "p-3"}`}>
                  <span
                    className={`block font-display font-semibold leading-[1.1] tracking-[-0.01em] ${small ? "text-[11px]" : "text-[16px]"}`}
                  >
                    {memory.label}
                  </span>
                  {!small && date && <span className="telemetry mt-1.5 block truncate text-white/80">{date}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
