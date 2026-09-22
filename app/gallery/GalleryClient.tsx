"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MediaIndexEntry } from "@/lib/media";
import { groupByDay } from "./dateGroups";
import MediaViewer from "./MediaViewer";

interface GalleryClientProps {
  initialItems: MediaIndexEntry[];
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function GalleryClient({ initialItems }: GalleryClientProps) {
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Newest first.
  const sorted = useMemo(
    () =>
      [...initialItems].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [initialItems]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => item.filename.toLowerCase().includes(q));
  }, [sorted, query]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Gallery</h1>
        <Link
          href="/upload"
          className="rounded border border-neutral-700 px-3 py-1.5 text-sm underline"
        >
          Upload photos
        </Link>
      </div>

      <input
        type="search"
        placeholder="Search by filename…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-neutral-700 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-400 sm:max-w-sm"
      />

      {initialItems.length === 0 && (
        <p className="text-neutral-500">No media yet.</p>
      )}
      {initialItems.length > 0 && filtered.length === 0 && (
        <p className="text-neutral-500">No photos match &quot;{query}&quot;.</p>
      )}

      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-neutral-400">
              {group.label}
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {group.items.map((item) => {
                const globalIndex = filtered.indexOf(item);
                return (
                  <button
                    key={item.id}
                    className="group relative aspect-square overflow-hidden rounded bg-neutral-900"
                    onClick={() => setOpenIndex(globalIndex)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/media/thumb/${item.id}/320`}
                      alt={item.filename}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    {item.mimeType?.startsWith("video/") && (
                      <div className="pointer-events-none absolute inset-0 flex items-end justify-between p-1.5">
                        <span className="rounded bg-black/60 px-1 text-[10px] text-white">
                          ▶
                        </span>
                        {typeof item.duration === "number" && item.duration > 0 && (
                          <span className="rounded bg-black/60 px-1 text-[10px] text-white">
                            {formatDuration(item.duration)}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {openIndex !== null && (
        <MediaViewer
          items={filtered}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
        />
      )}
    </main>
  );
}
