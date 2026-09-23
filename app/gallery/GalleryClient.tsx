"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
    </svg>
  );
}

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
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Lets deleteMedia() read the latest `items` without needing to be
  // recreated (and re-passed to children) on every items change.
  const itemsRef = useRef<MediaIndexEntry[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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

  /** Shared by both the viewer's single-item trash button and the grid's
   * multi-select bulk delete — one DELETE call either way (see
   * lib/media.deleteMedia), and either path keeps `items` + the
   * IndexedDB cache in sync the same way. Throws on failure so each caller
   * can show its own loading/error UI around the same underlying action. */
  async function deleteMedia(ids: string[]): Promise<string[]> {
    const unique = Array.from(new Set(ids));
    if (unique.length === 0) return [];
    const isSingle = unique.length === 1;
    const res = await fetch(isSingle ? `/api/media/${unique[0]}` : "/api/media", {
      method: "DELETE",
      ...(isSingle
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: unique }),
          }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? `Delete failed (${res.status})`);
    }
    const data = (await res.json()) as { deletedIds?: string[]; commitSha?: string };
    const deletedIds = data.deletedIds ?? unique;
    if (deletedIds.length > 0) {
      setItems((prev) => prev.filter((it) => !deletedIds.includes(it.id)));
      await applyMediaDiff(repoKey, [], deletedIds);
      // Keep the IndexedDB sync cursor current with the delete's own commit
      // (same as the initial sync effect's `setSyncState` call above) — the
      // gallery is already correct without this, but skipping it left
      // lastKnownSha one commit behind, so the next load's GET /api/media
      // always took the full unchanged:false re-fetch path instead of the
      // cheap short-circuit.
      if (data.commitSha) await setSyncState(repoKey, data.commitSha);
    }
    return deletedIds;
  }

  /** MediaViewer's trash button calls this directly; once it resolves the
   * item is gone from `items`, so the viewer is closed here rather than
   * trying to keep its `index` pointed at a now-shifted list. */
  async function handleViewerDelete(id: string): Promise<void> {
    await deleteMedia([id]);
    setOpenIndex(null);
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0 || deleting) return;
    const count = selectedIds.size;
    const confirmed = window.confirm(
      count === 1
        ? "Delete this item? This can't be undone from the gallery."
        : `Delete ${count} items? This can't be undone from the gallery.`
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMedia(Array.from(selectedIds));
      setSelectedIds(new Set());
      setSelectMode(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectMode() {
    setSelectMode((v) => {
      if (v) setSelectedIds(new Set());
      return !v;
    });
    setDeleteError(null);
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filtered.map((it) => it.id)));
  }

  /** Backfilled server-side (see GalleryThumb + lib/media.backfillThumbnailIfMissing)
   * — update this one item's `thumb` pointer in both the live list and the
   * IndexedDB cache so it renders the real thumbnail from now on, without
   * needing a full manifest re-sync.
   *
   * Wrapped in useCallback (stable across every GalleryClient re-render that
   * doesn't change `repoKey`, which in practice is every re-render post-
   * mount): every mounted GalleryThumb's backfill effect has this function
   * in its dependency array, so an unstable identity here tore down and
   * recreated that effect — with `cancelled` set on the old closure — on
   * every unrelated re-render (e.g. the initial sync's setItems/setReady, or
   * any other item's backfill success), silently discarding whichever
   * backfill fetches were still in flight even though they had already
   * succeeded server-side. */
  const handleThumbnailBackfilled = useCallback(
    (mediaId: string, thumbPath: string) => {
      const current = itemsRef.current.find((it) => it.id === mediaId);
      if (!current) return;
      const updatedEntry: MediaIndexEntry = { ...current, thumb: thumbPath };
      setItems((prev) => prev.map((it) => (it.id === mediaId ? updatedEntry : it)));
      applyMediaDiff(repoKey, [updatedEntry], []).catch(() => {});
    },
    [repoKey]
  );

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 pb-tabbar-safe sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-h1 font-bold tracking-tight">Gallery</h1>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={toggleSelectMode}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2 active:scale-95"
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          )}
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
      </div>

      {selectMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-small font-medium text-ink">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              className="text-small font-medium text-accent hover:underline"
            >
              Select all
            </button>
            {selectedIds.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-small font-medium text-ink-muted hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={selectedIds.size === 0 || deleting}
            onClick={handleBulkDelete}
            className="inline-flex items-center gap-1.5 rounded-full bg-danger px-4 py-2 text-small font-medium text-white transition-colors duration-180 hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <TrashIcon />
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
      {deleteError && <p className="text-small text-danger">{deleteError}</p>}

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
          selectMode={selectMode}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onThumbnailBackfilled={handleThumbnailBackfilled}
        />
      )}

      {openIndex !== null && (
        <MediaViewer
          items={filtered}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={setOpenIndex}
          onDelete={handleViewerDelete}
        />
      )}
    </main>
  );
}
