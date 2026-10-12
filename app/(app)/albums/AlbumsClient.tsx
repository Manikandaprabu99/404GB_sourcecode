"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Album } from "@/lib/albums/types";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { albumCoverId, albumHref, albumItemCount, createAlbum, loadAlbums } from "@/lib/library/albumsStore";
import { buildCategories, categoryCover, categoryHref, type Category } from "@/lib/library/categories";
import { afterOverlayClosed } from "@/lib/library/history";
import { useAlbums, useLibrary } from "@/lib/library/hooks";
import { TRASH_RETENTION_DAYS } from "@/lib/library/trash";
import { rememberAlbumListOrigin } from "@/lib/library/viewState";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import PeopleRow from "@/app/components/people/PeopleRow";
import AlbumNameSheet from "@/app/components/library/AlbumNameSheet";
import EmptyState, { primaryButtonClass } from "@/app/components/library/EmptyState";
import Notice, { noticeActionClass } from "@/app/components/library/Notice";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import { AlbumsIcon, ChevronRightIcon, FolderIcon, PlusIcon, RefreshIcon, TrashIcon } from "@/app/components/library/icons";

interface AlbumsClientProps {
  repoOwner: string;
  repoName: string;
}

function countLabel(count: number): string {
  return count === 1 ? "1 item" : `${count.toLocaleString()} items`;
}

// Cards fade in one after another, but a long list mustn't keep the last ones waiting.
function stagger(index: number): { animationDelay: string } {
  return { animationDelay: `${Math.min(index, 12) * 25}ms` };
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-body-lg font-semibold tracking-tight text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AlbumCard({
  album,
  repoKey,
  coverId,
  cover,
  count,
}: {
  album: Album;
  repoKey: string;
  coverId: string | undefined;
  cover?: MediaIndexEntry;
  count: number;
}) {
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
      <p className="text-small text-ink-muted">{countLabel(count)}</p>
    </Link>
  );
}

function CategoryCard({ category, repoKey }: { category: Category; repoKey: string }) {
  const cover = categoryCover(category.items);
  return (
    <Link
      href={categoryHref(category.id)}
      onClick={() => rememberAlbumListOrigin(`category:${category.id}`)}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="relative aspect-square overflow-hidden rounded-xl bg-surface-2 transition-transform duration-250 ease-out-expo group-hover:-translate-y-0.5 group-active:scale-[0.97]">
        {cover ? (
          <GalleryThumb
            repoKey={repoKey}
            mediaId={cover.id}
            alt=""
            hasThumbnail={Boolean(cover.thumb)}
            isVideo={cover.mimeType.startsWith("video/")}
            className="h-full w-full object-cover transition-transform duration-320 ease-out-expo group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-faint">
            <FolderIcon size={28} />
          </div>
        )}
      </div>
      <p className="mt-1.5 truncate text-small font-medium text-ink">{category.name}</p>
      <p className="text-micro text-ink-muted">{category.items.length.toLocaleString()}</p>
    </Link>
  );
}

// Denser than albums: they're shortcuts into the library, not collections the user made.
const CATEGORY_GRID = "grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8";
const ALBUM_GRID = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

/** Library: People, automatic categories, the user's albums, and Trash. */
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
  const trashedIds = useMemo(() => new Set(library.trashed.map((item) => item.id)), [library.trashed]);
  const categories = useMemo(() => buildCategories(library.items), [library.items]);

  const albumsLoading = albums.length === 0 && !albumsState.loaded && !albumsState.error;
  const libraryLoading = library.items.length === 0 && (!library.hydrated || (!library.synced && !library.error));
  const retry = () => void loadAlbums({ force: true });

  async function create(name: string) {
    const album = await createAlbum(name);
    setCreating(false);
    rememberAlbumListOrigin(album.id);
    afterOverlayClosed(() => router.push(albumHref(album.id)));
  }

  let albumsContent: JSX.Element;
  if (albumsLoading) {
    albumsContent = (
      <ul aria-busy="true" className={ALBUM_GRID}>
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i}>
            <div className="skeleton aspect-square rounded-xl" />
            <div className="skeleton mt-2.5 h-4 w-2/3 rounded-full" />
            <div className="skeleton mt-1.5 h-3 w-1/3 rounded-full" />
          </li>
        ))}
      </ul>
    );
  } else if (albums.length === 0 && albumsState.error) {
    albumsContent = (
      <EmptyState illustration="error" title="Couldn't load your albums" message={albumsState.error.message}>
        <button type="button" onClick={retry} className={primaryButtonClass}>
          <RefreshIcon size={16} />
          Retry
        </button>
      </EmptyState>
    );
  } else {
    albumsContent = (
      <ul className={ALBUM_GRID}>
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
            <span className="block text-small text-ink-muted">
              {albums.length === 0 ? "Group photos and videos" : " "}
            </span>
          </button>
        </li>
        {albums.map((album, i) => {
          const coverId = albumCoverId(album, trashedIds);
          return (
            <li key={album.id} className="animate-fade-in" style={stagger(i + 1)}>
              <AlbumCard
                album={album}
                repoKey={repoKey}
                coverId={coverId}
                cover={coverId ? entriesById.get(coverId) : undefined}
                count={albumItemCount(album, trashedIds)}
              />
            </li>
          );
        })}
      </ul>
    );
  }

  let categoriesContent: JSX.Element | null;
  if (categories.length > 0) {
    categoriesContent = (
      <ul className={CATEGORY_GRID}>
        {categories.map((category, i) => (
          <li key={category.id} className="animate-fade-in" style={stagger(i)}>
            <CategoryCard category={category} repoKey={repoKey} />
          </li>
        ))}
      </ul>
    );
  } else if (libraryLoading) {
    categoriesContent = (
      <ul aria-busy="true" className={CATEGORY_GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <div className="skeleton aspect-square rounded-xl" />
            <div className="skeleton mt-2 h-3.5 w-2/3 rounded-full" />
          </li>
        ))}
      </ul>
    );
  } else {
    categoriesContent = null;
  }

  const trashCount = library.trashed.length;

  return (
    <>
      <ScrollArea scrollKey="albums">
        <PageHeader
          title="Albums"
          actions={
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
            >
              <PlusIcon size={16} />
              New album
            </button>
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
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 pb-4 pt-2 sm:px-6">
          <PeopleRow repoKey={repoKey} />

          {categoriesContent && <Section title="Categories">{categoriesContent}</Section>}

          <Section title="Your albums">{albumsContent}</Section>

          <Link
            href="/albums/trash"
            onClick={() => rememberAlbumListOrigin("trash")}
            className="group flex animate-fade-in items-center gap-3.5 rounded-2xl border border-border bg-surface px-4 py-3.5 outline-none transition-colors duration-180 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted transition-colors duration-180 group-hover:bg-surface-3">
              <TrashIcon size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-body font-medium text-ink">Trash</span>
              <span className="block truncate text-small text-ink-muted">
                {trashCount > 0
                  ? `${countLabel(trashCount)} · kept for ${TRASH_RETENTION_DAYS} days`
                  : `Deleted items stay here for ${TRASH_RETENTION_DAYS} days`}
              </span>
            </span>
            <ChevronRightIcon size={18} className="shrink-0 text-ink-faint transition-transform duration-180 group-hover:translate-x-0.5" />
          </Link>
        </div>
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
