"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Album } from "@/lib/albums/types";
import { useToast } from "@/app/components/ui/Toast";
import VirtualGrid from "@/app/gallery/VirtualGrid";
import { groupByDay } from "@/app/gallery/dateGroups";
import { addToAlbum } from "@/lib/library/albumsStore";
import { useLibrary } from "@/lib/library/hooks";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import EmptyState, { primaryButtonClass } from "./EmptyState";
import SkeletonGrid from "./SkeletonGrid";
import { CloseIcon } from "./icons";

interface AlbumPhotoPickerProps {
  repoKey: string;
  album: Album;
  onClose: () => void;
}

/** Full-screen picker for adding library items to an album. */
export default function AlbumPhotoPicker({ repoKey, album, onClose }: AlbumPhotoPickerProps) {
  const toast = useToast();
  const library = useLibrary(repoKey);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  useHistoryOverlay(true, onClose);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const candidates = useMemo(() => {
    const inAlbum = new Set(album.mediaIds);
    return library.items.filter((item) => !inAlbum.has(item.id));
  }, [album.mediaIds, library.items]);
  const groups = useMemo(() => groupByDay(candidates), [candidates]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (groupKey: string) => {
      const group = groups.find((g) => g.key === groupKey);
      if (!group) return;
      setSelected((prev) => {
        const all = group.items.every((item) => prev.has(item.id));
        const next = new Set(prev);
        for (const item of group.items) {
          if (all) next.delete(item.id);
          else next.add(item.id);
        }
        return next;
      });
    },
    [groups]
  );

  function add() {
    const ids = candidates.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (ids.length === 0) return;
    onClose();
    toast({ message: `Added ${ids.length === 1 ? "1 item" : `${ids.length} items`} to ${album.name}` });
    addToAlbum(album.id, ids).catch(() =>
      toast({ tone: "error", message: `Couldn't add to ${album.name}. Try again.` })
    );
  }

  const loading = candidates.length === 0 && (!library.hydrated || (!library.synced && !library.error));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Add to ${album.name}`}
      className="fixed inset-0 z-viewer flex animate-fade-in flex-col bg-bg pl-safe pr-safe"
    >
      <header className="shrink-0 border-b border-border pt-safe">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-2 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          >
            <CloseIcon size={20} />
          </button>
          <div className="min-w-0 flex-1 pl-1">
            <h2 className="truncate text-h3 font-semibold tracking-tight text-ink">Add to {album.name}</h2>
            <p aria-live="polite" className="truncate text-micro text-ink-muted">
              {selected.size > 0
                ? `${selected.size} selected`
                : "Tap photos and videos to select them"}
            </p>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={selected.size === 0}
            className={`${primaryButtonClass} !px-4 !py-2`}
          >
            Add
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain sm:px-6">
        {loading ? (
          <SkeletonGrid />
        ) : candidates.length === 0 ? (
          <EmptyState
            illustration="photos"
            title="Nothing to add"
            message={
              library.items.length === 0
                ? "Your library is empty. Upload or back up photos first."
                : "Everything in your library is already in this album."
            }
          />
        ) : (
          <VirtualGrid
            groups={groups}
            zoom="day"
            repoKey={repoKey}
            scrollRef={scrollRef}
            stickyTop={0}
            selectMode
            selectedIds={selected}
            onOpen={toggle}
            onToggleSelect={toggle}
            onStartSelect={toggle}
            onToggleGroup={toggleGroup}
          />
        )}
        <div aria-hidden="true" className="h-[calc(1.5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]" />
      </div>
    </div>
  );
}
