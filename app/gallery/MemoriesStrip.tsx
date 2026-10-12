"use client";

import type { Memory } from "@/lib/library/memories";
import type { ZoomLevel } from "@/lib/library/zoom";
import { MemoriesIcon } from "@/app/components/library/icons";
import GalleryThumb from "./GalleryThumb";

interface MemoriesStripProps {
  memories: Memory[];
  repoKey: string;
  zoom: ZoomLevel;
  /** Selecting in the grid: the cards wait. */
  disabled: boolean;
  onOpen: (memory: Memory) => void;
}

// Big cards in the day view, smaller in the month view; the year view is an overview without them.
const CARD: Record<Exclude<ZoomLevel, "year">, string> = {
  day: "h-44 w-32 sm:h-52 sm:w-40",
  month: "h-28 w-20 sm:h-32 sm:w-24",
};

function dateLine(memory: Memory): string {
  const taken = memory.items[0]?.takenAt;
  if (!taken) return "";
  return new Date(taken).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** "On this day": a card per earlier year with photos from today's date (±1 day). */
export default function MemoriesStrip({ memories, repoKey, zoom, disabled, onOpen }: MemoriesStripProps) {
  if (memories.length === 0 || zoom === "year") return null;
  const small = zoom === "month";
  return (
    <section
      aria-label="On this day"
      className={`animate-fade-in pb-2 pt-1 transition-opacity duration-180 ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <h2 className="flex items-center gap-1.5 px-4 pb-2 text-small font-semibold text-ink sm:px-6">
        <MemoriesIcon size={16} className="text-accent" />
        On this day
      </h2>
      <ul className="flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:scroll-px-6 sm:gap-2.5 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {memories.map((memory, i) => {
          const count = memory.items.length;
          return (
            <li key={memory.key} className="snap-start animate-fade-in-up" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <button
                type="button"
                data-memory={memory.key}
                disabled={disabled}
                onClick={() => onOpen(memory)}
                aria-label={`${memory.label}, ${count === 1 ? "1 item" : `${count} items`}`}
                className={`group relative block shrink-0 overflow-hidden rounded-xl bg-surface-2 outline-none transition-transform duration-250 ease-out-expo hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.97] ${CARD[small ? "month" : "day"]}`}
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
                <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                <span className={`pointer-events-none absolute inset-x-0 bottom-0 text-left text-white ${small ? "p-1.5" : "p-2.5"}`}>
                  <span className={`block font-semibold leading-tight ${small ? "text-micro" : "text-small"}`}>{memory.label}</span>
                  {!small && <span className="mt-0.5 block text-micro text-white/75">{dateLine(memory)}</span>}
                </span>
                {count > 1 && (
                  <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white backdrop-blur-sm">
                    {count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
