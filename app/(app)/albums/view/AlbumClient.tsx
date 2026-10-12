"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { repoKeyFor } from "@/lib/cache";
import { deleteAlbum, renameAlbum } from "@/lib/library/albumsStore";
import { mediaTime } from "@/lib/library/dates";
import { afterOverlayClosed, closeOverlaysThen } from "@/lib/library/history";
import { useAlbums, useLibrary } from "@/lib/library/hooks";
import { cameFromAlbumList } from "@/lib/library/viewState";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import AlbumNameSheet from "@/app/components/library/AlbumNameSheet";
import AlbumPhotoPicker from "@/app/components/library/AlbumPhotoPicker";
import EmptyState, { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import MediaLibraryView from "@/app/components/library/MediaLibraryView";
import OverflowMenu from "@/app/components/library/OverflowMenu";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import SkeletonGrid from "@/app/components/library/SkeletonGrid";
import { BackIcon, PencilIcon, PlusIcon, TrashIcon } from "@/app/components/library/icons";

interface AlbumClientProps {
  repoOwner: string;
  repoName: string;
  albumId: string;
}

function dateRange(newest: number, oldest: number): string {
  if (newest <= 0 || oldest <= 0) return "";
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return format.formatRange(new Date(oldest), new Date(newest));
}

const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink";

export default function AlbumClient({ repoOwner, repoName, albumId }: AlbumClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const library = useLibrary(repoKey);
  const albumsState = useAlbums(repoKey);
  const album = albumsState.albums.find((a) => a.id === albumId);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const action = signedOutAction(library.error, albumsState.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [library.error, albumsState.error, router]);

  const items = useMemo(() => {
    if (!album) return [];
    const ids = new Set(album.mediaIds);
    return library.items.filter((item) => ids.has(item.id));
  }, [album, library.items]);

  const subtitle = useMemo(() => {
    if (!album) return "";
    // Before the library has loaded, the album's own list is the best count (items in Trash included).
    const count = items.length > 0 || library.synced ? items.length : album.mediaIds.length;
    const parts = [count === 1 ? "1 item" : `${count} items`];
    if (items.length > 0) {
      const range = dateRange(mediaTime(items[0]), mediaTime(items[items.length - 1]));
      if (range) parts.push(range);
    }
    return parts.join(" · ");
  }, [album, items, library.synced]);

  const goBack = () =>
    closeOverlaysThen(() => {
      if (cameFromAlbumList(albumId) && window.history.length > 1) router.back();
      else router.push("/albums");
    });

  const backButton = (
    <button type="button" onClick={goBack} aria-label="Back to albums" className={iconButtonClass}>
      <BackIcon size={20} />
    </button>
  );

  if (!album) {
    const notFound = albumsState.loaded && !leaving;
    return (
      <ScrollArea scrollKey={`album:${albumId}`}>
        <PageHeader title={notFound ? "Album" : ""} leading={backButton} />
        {notFound ? (
          <EmptyState
            illustration="albums"
            title="Album not found"
            message="It may have been deleted on another device."
          >
            <Link href="/albums" className={primaryButtonClass}>
              See all albums
            </Link>
          </EmptyState>
        ) : (
          <div className="sm:px-6">
            <SkeletonGrid />
          </div>
        )}
      </ScrollArea>
    );
  }

  const currentAlbum = album;

  async function removeAlbum() {
    const ok = await confirm({
      title: `Delete “${currentAlbum.name}”?`,
      message: "Only the album is deleted. Its photos and videos stay in your library.",
      confirmLabel: "Delete album",
      destructive: true,
    });
    if (!ok) return;
    setLeaving(true);
    const name = currentAlbum.name;
    deleteAlbum(currentAlbum.id).then(
      () => toast({ message: `Deleted ${name}` }),
      () => toast({ tone: "error", message: `Couldn't delete ${name}. Try again.` })
    );
    // The confirm dialog pops its own history entry first; navigating before that would be undone.
    afterOverlayClosed(() => router.replace("/albums"));
  }

  async function rename(name: string) {
    setRenaming(false);
    renameAlbum(currentAlbum.id, name).catch(() =>
      toast({ tone: "error", message: "Couldn't rename the album. Try again." })
    );
  }

  const loading =
    items.length === 0 && album.mediaIds.length > 0 && (!library.hydrated || (!library.synced && !library.error));

  return (
    <>
      <MediaLibraryView
        repoKey={repoKey}
        scrollKey={`album:${albumId}`}
        items={items}
        loading={loading}
        album={album}
        empty={
          <EmptyState
            illustration="albums"
            title="This album is empty"
            message="Add photos and videos from your library."
          >
            <button type="button" onClick={() => setPicking(true)} className={primaryButtonClass}>
              <PlusIcon size={16} />
              Add photos
            </button>
            <button type="button" onClick={() => setRenaming(true)} className={secondaryButtonClass}>
              Rename
            </button>
          </EmptyState>
        }
        header={({ selectMode, startSelect }) => (
          <div className="bg-bg pt-safe sm:pt-0">
            <div className="flex h-14 items-center gap-1 px-2 sm:px-6">
              {backButton}
              <div className="min-w-0 flex-1 pl-1">
                <h1 className="truncate text-h3 font-semibold tracking-tight text-ink">{album.name}</h1>
                <p className="truncate text-micro text-ink-muted">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setPicking(true)}
                aria-label="Add photos"
                title="Add photos"
                className={iconButtonClass}
              >
                <PlusIcon size={20} />
              </button>
              {items.length > 0 && !selectMode && (
                <button
                  type="button"
                  onClick={startSelect}
                  className="h-9 shrink-0 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
                >
                  Select
                </button>
              )}
              <OverflowMenu
                label="Album options"
                items={[
                  {
                    key: "rename",
                    label: "Rename album",
                    icon: <PencilIcon size={18} />,
                    onSelect: () => setRenaming(true),
                  },
                  {
                    key: "add",
                    label: "Add photos",
                    icon: <PlusIcon size={18} />,
                    onSelect: () => setPicking(true),
                  },
                  {
                    key: "delete",
                    label: "Delete album",
                    icon: <TrashIcon size={18} />,
                    tone: "danger",
                    onSelect: () => void removeAlbum(),
                  },
                ]}
              />
            </div>
          </div>
        )}
      />

      {picking && <AlbumPhotoPicker repoKey={repoKey} album={album} onClose={() => setPicking(false)} />}

      <AlbumNameSheet
        open={renaming}
        title="Rename album"
        initialName={album.name}
        submitLabel="Save"
        busyLabel="Saving…"
        onSubmit={rename}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}
