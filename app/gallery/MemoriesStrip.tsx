"use client";

import { useEffect, useRef, useState } from "react";
import type { Spotlight } from "@/lib/library/memories";
import type { ZoomLevel } from "@/lib/library/zoom";
import GalleryThumb from "./GalleryThumb";

interface MemoriesStripProps {
  spotlights: Spotlight[];
  repoKey: string;
  zoom: ZoomLevel;
  /** Selecting in the grid: the cards wait. */
  disabled: boolean;
  /** Opens the card's story. */
  onPlay: (spotlight: Spotlight) => void;
}

// About 0.8 on phones and 21:9 on desktop; shorter in Month view, hidden in Year view.
const CARD: Record<Exclude<ZoomLevel, "year">, string> = {
  day: "aspect-[4/5] max-h-[min(30rem,58vh)] sm:aspect-[21/9] sm:max-h-[27.5rem]",
  month: "aspect-[2/1] max-h-[14rem] sm:aspect-[32/9] sm:max-h-[15rem]",
};

function PlayGlyph() {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.28)]">
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" fill="currentColor">
        <path d="M3.2 1.7v8.6a.7.7 0 0 0 1.06.6l6.9-4.3a.7.7 0 0 0 0-1.2L4.26 1.1a.7.7 0 0 0-1.06.6Z" />
      </svg>
    </span>
  );
}

/** Spotlight hero carousel. Only the card in view drifts (Ken Burns transform); it never
 * scrolls by itself, since the face scanner treats scroll events as user input. */
export default function MemoriesStrip({ spotlights, repoKey, zoom, disabled, onPlay }: MemoriesStripProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const count = spotlights.length;
  const hidden = count === 0 || zoom === "year";
  const keys = spotlights.map((spot) => spot.key).join("|");

  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            setActive(Number((entry.target as HTMLElement).dataset.index) || 0);
          }
        }
      },
      { root: track, threshold: [0.6] }
    );
    for (const card of track.querySelectorAll<HTMLElement>("[data-index]")) observer.observe(card);
    return () => observer.disconnect();
  }, [keys, hidden]);

  useEffect(() => {
    if (active >= count) setActive(0);
  }, [active, count]);

  if (hidden) return null;
  const small = zoom === "month";

  const goTo = (index: number) => {
    const track = trackRef.current;
    const card = track?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!track || !card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.offsetWidth) / 2, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section
      aria-label="Memories"
      aria-roledescription="carousel"
      className={`relative animate-fade-in pb-1 pt-1 transition-opacity duration-160 ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <div ref={trackRef} className="lp-hero-track flex gap-2.5 overflow-x-auto scroll-px-4 px-4 sm:scroll-px-6 sm:gap-3 sm:px-6">
        {spotlights.map((spot, index) => (
          <button
            key={spot.key}
            type="button"
            data-memory={spot.key}
            data-index={index}
            data-active={index === active}
            disabled={disabled}
            onClick={() => onPlay(spot)}
            aria-label={spot.label}
            aria-roledescription="slide"
            className={`lp-hero-card group relative block w-full shrink-0 overflow-hidden rounded-[26px] bg-surface-2 text-left outline-none transition-transform duration-160 ease-out focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.985] ${CARD[small ? "month" : "day"]}`}
          >
            <span className="lp-kb absolute inset-0 block">
              <GalleryThumb
                repoKey={repoKey}
                mediaId={spot.cover.id}
                alt=""
                size={800}
                hasThumbnail={Boolean(spot.cover.thumb)}
                isVideo={spot.cover.mimeType.startsWith("video/")}
                className="h-full w-full object-cover"
              />
            </span>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black/75 via-black/30 to-transparent" />
            <span className={`pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-3 ${small ? "p-4" : "p-5 sm:p-7"}`}>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate font-semibold text-white ${small ? "text-[17px] leading-[22px] tracking-[-0.01em]" : "text-[22px] leading-[28px] tracking-[-0.015em] sm:text-[28px] sm:leading-[34px]"}`}
                >
                  {spot.title}
                </span>
                {spot.subtitle && (
                  <span className="mt-0.5 block truncate text-[13px] leading-[18px] text-white/80 tabular-nums">{spot.subtitle}</span>
                )}
              </span>
              <PlayGlyph />
            </span>
          </button>
        ))}
      </div>
      {count > 1 && (
        <div className="flex h-6 items-center justify-center gap-1.5" role="group" aria-label="Memories pages">
          {spotlights.map((spot, index) => (
            <button
              key={spot.key}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`${spot.title} (${index + 1} of ${count})`}
              aria-current={index === active || undefined}
              className="relative flex h-6 w-3 items-center justify-center outline-none after:absolute after:-inset-x-1 after:inset-y-0 after:content-['']"
            >
              <span
                className={`lp-dot block h-1.5 w-1.5 rounded-full ${index === active ? "scale-[1.3] bg-[rgb(var(--accent-text,var(--accent)))] opacity-100" : "bg-ink-muted opacity-40"}`}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
