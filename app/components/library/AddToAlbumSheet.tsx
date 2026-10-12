"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Sheet from "@/app/components/ui/Sheet";
import { useToast } from "@/app/components/ui/Toast";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import type { Album } from "@/lib/albums/types";
import { addToAlbum, albumCoverId, albumHref, albumItemCount, createAlbum, loadAlbums } from "@/lib/library/albumsStore";
import { useAlbums, useLibrary } from "@/lib/library/hooks";
import { AlbumsIcon, CheckIcon, PlusIcon } from "./icons";

interface AddToAlbumSheetProps {
  repoKey: string;
  /** Items to add; null keeps the sheet closed. */
  mediaIds: readonly string[] | null;
  onClose: () => void;
  /** After the items were handed to an album (e.g. to leave selection mode). */
  onAdded?: () => void;
  /** Hidden from the list (the album currently being viewed). */
  excludeAlbumId?: string;
}

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export default function AddToAlbumSheet({
  repoKey,
  mediaIds,
  onClose,
  onAdded,
  excludeAlbumId,
}: AddToAlbumSheetProps) {
  const router = useRouter();
  const toast = useToast();
  const library = useLibrary(repoKey);
  const albumsState = useAlbums(repoKey);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = mediaIds !== null;

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setName("");
    setError(null);
    void loadAlbums();
  }, [open]);

  const entriesById = useMemo(() => new Map(library.items.map((item) => [item.id, item])), [library.items]);
  const trashedIds = useMemo(() => new Set(library.trashed.map((item) => item.id)), [library.trashed]);
  const albums = useMemo(
    () =>
      albumsState.albums
        .filter((album) => album.id !== excludeAlbumId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    [albumsState.albums, excludeAlbumId]
  );

  const viewAlbum = (album: Album) => router.push(albumHref(album.id));

  function pick(album: Album) {
    if (!mediaIds) return;
    const existing = new Set(album.mediaIds);
    const fresh = mediaIds.filter((id) => !existing.has(id));
    onClose();
    onAdded?.();
    if (fresh.length === 0) {
      toast({ message: `Already in ${album.name}` });
      return;
    }
    toast({
      message: `Added ${countLabel(fresh.length)} to ${album.name}`,
      actionLabel: "View",
      onAction: () => viewAlbum(album),
    });
    addToAlbum(album.id, fresh).catch(() => {
      toast({ tone: "error", message: `Couldn't add to ${album.name}. Try again.` });
    });
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy || !mediaIds) return;
    setBusy(true);
    setError(null);
    try {
      const album = await createAlbum(trimmed, mediaIds);
      onClose();
      onAdded?.();
      toast({ message: `Created ${album.name}`, actionLabel: "View", onAction: () => viewAlbum(album) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the album.");
    } finally {
      setBusy(false);
    }
  }

  const showSkeleton = !albumsState.loaded && albums.length === 0 && !albumsState.error;

  return (
    <Sheet open={open} onClose={onClose} title="Add to album">
      <div className="flex flex-col gap-1 pb-1">
        {creating ? (
          <form
            onSubmit={submitNew}
            className="flex animate-fade-in items-center gap-2 rounded-xl border border-border bg-surface-2 p-1.5 pl-3"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Album name"
              aria-label="Album name"
              className="min-w-0 flex-1 bg-transparent py-2 text-body text-ink outline-none placeholder:text-ink-faint"
            />
            <button
              type="submit"
              disabled={!name.trim() || busy}
              className="rounded-full bg-ink px-4 py-2 text-small font-semibold text-bg transition-opacity duration-180 disabled:opacity-40"
            >
              {busy ? "Creating…" : "Create"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-180 hover:bg-surface-2 active:bg-surface-3"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-accent">
              <PlusIcon size={20} />
            </span>
            <span className="text-body font-medium text-ink">New album</span>
          </button>
        )}
        {error && <p className="px-2 text-small text-danger">{error}</p>}

        <div className="-mx-1 max-h-[50vh] overflow-y-auto px-1">
          {showSkeleton &&
            [0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <span className="skeleton block h-12 w-12 rounded-lg" />
                <span className="skeleton block h-4 w-32 rounded" />
              </div>
            ))}

          {!albumsState.loaded && albums.length === 0 && albumsState.error && (
            <div className="flex items-center justify-between gap-3 px-2 py-3">
              <p className="text-small text-ink-muted">{albumsState.error.message}</p>
              <button
                type="button"
                onClick={() => void loadAlbums({ force: true })}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-small font-medium text-ink hover:bg-surface-2"
              >
                Retry
              </button>
            </div>
          )}

          {albums.map((album) => {
            const coverId = albumCoverId(album, trashedIds);
            const cover = coverId ? entriesById.get(coverId) : undefined;
            const containsAll = mediaIds !== null && mediaIds.every((id) => album.mediaIds.includes(id));
            return (
              <button
                key={album.id}
                type="button"
                onClick={() => pick(album)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-180 hover:bg-surface-2 active:bg-surface-3"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 text-ink-faint">
                  {coverId ? (
                    <GalleryThumb
                      repoKey={repoKey}
                      mediaId={coverId}
                      alt=""
                      hasThumbnail={cover ? Boolean(cover.thumb) : true}
                      isVideo={cover?.mimeType.startsWith("video/")}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <AlbumsIcon size={20} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{album.name}</span>
                  <span className="block text-small text-ink-muted">{countLabel(albumItemCount(album, trashedIds))}</span>
                </span>
                {containsAll && <CheckIcon size={16} className="shrink-0 text-accent" />}
              </button>
            );
          })}

          {albumsState.loaded && albums.length === 0 && !creating && (
            <p className="px-2 py-3 text-small text-ink-muted">No albums yet. Create one above.</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
