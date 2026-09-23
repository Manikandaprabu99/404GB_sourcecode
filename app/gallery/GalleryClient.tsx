"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { MediaIndexEntry } from "@/lib/media";
import {
  repoKeyFor,
  getCachedMediaIndex,
  applyMediaDiff,
  diffMediaIndex,
  getSyncState,
  setSyncState,
} from "@/lib/cache";
import { groupByDay } from "./dateGroups";
import MediaViewer from "./MediaViewer";
import VirtualGrid from "./VirtualGrid";

interface GalleryClientProps {
  repoOwner: string;
  repoName: string;
}

interface MediaResponse {
  unchanged: boolean;
  sha: string;
  media?: MediaIndexEntry[];
}

export default function GalleryClient({ repoOwner, repoName }: GalleryClientProps) {
  const repoKey = useMemo(() => repoKeyFor(repoOwner, repoName), [repoOwner, repoName]);
  const [items, setItems] = useState<MediaIndexEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Section 11 sync strategy: render whatever's cached in IndexedDB
  // immediately, then check the repo's HEAD sha; only re-fetch
  // media-index.json (and update the cache) if it actually changed.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = await getCachedMediaIndex(repoKey);
      if (cancelled) return;
      if (cached.length > 0) setItems(cached);

      try {
        const syncState = await getSyncState(repoKey);
        const sinceSha = syncState?.lastKnownSha ?? "";
        const res = await fetch(`/api/media?sinceSha=${encodeURIComponent(sinceSha)}`);
        if (!res.ok || cancelled) return;

        const data = (await res.json()) as MediaResponse;
        if (cancelled || data.unchanged) return;

        const fresh = data.media ?? [];
        const diff = diffMediaIndex(cached, fresh);
        if (diff.changed) {
          await applyMediaDiff(repoKey, diff.upserts, diff.removedIds);
        }
        if (data.sha) await setSyncState(repoKey, data.sha);
        if (!cancelled) setItems(fresh);
      } catch {
        // Offline or a GitHub API hiccup — keep serving whatever's cached.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [repoKey]);

  // Newest first.
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => item.filename.toLowerCase().includes(q));
  }, [sorted, query]);

  // O(1) id -> position lookups for the viewer, instead of an indexOf() call
  // per rendered item.
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((item, i) => map.set(item.id, i));
    return map;
  }, [filtered]);

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 pb-tabbar-safe sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold tracking-tight">Gallery</h1>
        <Link
          href="/upload"
          className="group inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-small font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95"
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Upload
        </Link>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          type="search"
          placeholder="Search by filename…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-full border border-border bg-surface py-2.5 pl-10 pr-4 text-body text-ink outline-none transition-colors duration-180 placeholder:text-ink-faint focus:border-accent"
        />
      </div>

      {!ready && items.length === 0 && (
        <p className="animate-fade-in text-body text-ink-muted">Loading…</p>
      )}
      {ready && items.length === 0 && (
        <p className="animate-fade-in text-body text-ink-muted">No media yet.</p>
      )}
      {items.length > 0 && filtered.length === 0 && (
        <p className="animate-fade-in text-body text-ink-muted">
          No photos match &quot;{query}&quot;.
        </p>
      )}

      {filtered.length > 0 && (
        <VirtualGrid
          groups={groups}
          repoKey={repoKey}
          indexById={indexById}
          onOpen={setOpenIndex}
        />
      )}

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
