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

      {!ready && items.length === 0 && (
        <p className="text-neutral-500">Loading…</p>
      )}
      {ready && items.length === 0 && (
        <p className="text-neutral-500">No media yet.</p>
      )}
      {items.length > 0 && filtered.length === 0 && (
        <p className="text-neutral-500">No photos match &quot;{query}&quot;.</p>
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
