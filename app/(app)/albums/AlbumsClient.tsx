"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Album } from "@/lib/albums/types";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { albumCoverId, albumHref, createAlbum, loadAlbums } from "@/lib/library/albumsStore";
import { afterOverlayClosed } from "@/lib/library/history";
import { useAlbums, useLibrary } from "@/lib/library/hooks";
import { rememberAlbumListOrigin } from "@/lib/library/viewState";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import AlbumNameSheet from "@/app/components/library/AlbumNameSheet";
import EmptyState, { primaryButtonClass } from "@/app/components/library/EmptyState";
import Notice, { noticeActionClass } from "@/app/components/library/Notice";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import { AlbumsIcon, PlusIcon, RefreshIcon } from "@/app/components/library/icons";

interface AlbumsClientProps {
  repoOwner: string;
  repoName: string;
}

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

function AlbumCard({ album, repoKey, cover }: { album: Album; repoKey: string; cover?: MediaIndexEntry }) {
  const coverId = albumCoverId(album);
  return (
    <Link
      href={albumHref(album.id)}
      onClick={() => rememberAlbumListOrigin(album.id)}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2 transition-transform duration-250 ease-out-expo group-hover:-translate-y-0.5 group-active:scale-[0.97]">
        {coverId ? (
          <GalleryThumb
            repoKey={repoKey}
            mediaId={coverId}
            alt=""
            size={800}
            hasThumbnail={cover ? Boolean(cover.thumb) : true}
            isVideo={cover?.mimeType.startsWith("video/")}
            className="h-full w-full object-cover transition-transform duration-320 ease-out-expo group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-faint">
            <AlbumsIcon size={36} />
          </div>
        )}
      </div>
      <p className="mt-2 truncate text-body font-medium text-ink">{album.name}</p>
      <p className="text-small text-ink-muted">{countLabel(album.mediaIds.length)}</p>
    </Link>
  );
}

export default function AlbumsClient({ repoOwner, repoName }: AlbumsClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const library = useLibrary(repoKey);
  const albumsState = useAlbums(repoKey);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const action = signedOutAction(albumsState.error, library.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [albumsState.error, library.error, router]);

  const albums = useMemo(
    () => [...albumsState.albums].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    [albumsState.albums]
  );
  const entriesById = useMemo(() => new Map(library.items.map((item) => [item.id, item])), [library.items]);

  const loading = albums.length === 0 && !albumsState.loaded && !albumsState.error;
  const retry = () => void loadAlbums({ force: true });

  async function create(name: string) {
    const album = await createAlbum(name);
    setCreating(false);
    rememberAlbumListOrigin(album.id);
    afterOverlayClosed(() => router.push(albumHref(album.id)));
  }

  let content: JSX.Element;
  if (loading) {
    content = (
      <ul aria-busy="true" className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <div className="skeleton aspect-square rounded-xl" />
            <div className="skeleton mt-2.5 h-4 w-2/3 rounded-full" />
            <div className="skeleton mt-1.5 h-3 w-1/3 rounded-full" />
          </li>
        ))}
      </ul>
    );
  } else if (albums.length === 0 && albumsState.error) {
    content = (
      <EmptyState illustration="error" title="Couldn't load your albums" message={albumsState.error.message}>
        <button type="button" onClick={retry} className={primaryButtonClass}>
          <RefreshIcon size={16} />
          Retry
        </button>
      </EmptyState>
    );
  } else if (albums.length === 0) {
    content = (
      <EmptyState
        illustration="albums"
        title="No albums yet"
        message="Group photos and videos into albums. Create one here, or select photos in Photos and tap Add to album."
      >
        <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
          <PlusIcon size={16} />
          New album
        </button>
      </EmptyState>
    );
  } else {
    content = (
      <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <li className="animate-fade-in">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="group block w-full text-left outline-none"
          >
            <span className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border-strong text-accent transition-all duration-250 ease-out-expo group-hover:border-accent group-hover:bg-accent/5 group-active:scale-[0.97] group-focus-visible:border-accent">
              <PlusIcon size={28} />
            </span>
            <span className="mt-2 block text-body font-medium text-ink">New album</span>
            <span className="block text-small text-ink-muted">&nbsp;</span>
          </button>
        </li>
        {albums.map((album) => {
          const coverId = albumCoverId(album);
          return (
            <li key={album.id} className="animate-fade-in">
              <AlbumCard album={album} repoKey={repoKey} cover={coverId ? entriesById.get(coverId) : undefined} />
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <>
      <ScrollArea scrollKey="albums">
        <PageHeader
          title="Albums"
          actions={
            albums.length > 0 ? (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
              >
                <PlusIcon size={16} />
                New album
              </button>
            ) : null
          }
        />
        {albums.length > 0 && albumsState.error && albumsState.error.kind !== "auth" && (
          <Notice
            tone={albumsState.error.kind === "offline" ? "offline" : "warn"}
            action={
              <button type="button" onClick={retry} className={noticeActionClass}>
                Retry
              </button>
            }
          >
            {albumsState.error.kind === "offline"
              ? "You're offline. Showing albums saved on this device."
              : albumsState.error.message}
          </Notice>
        )}
        <div className="mx-auto w-full max-w-6xl px-4 pb-4 pt-2 sm:px-6">{content}</div>
      </ScrollArea>

      <AlbumNameSheet
        open={creating}
        title="New album"
        submitLabel="Create"
        busyLabel="Creating…"
        onSubmit={create}
        onClose={() => setCreating(false)}
      />
    </>
  );
}
