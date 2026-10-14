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
import { SettingsCard, SettingsRow } from "@/app/components/library/SettingsBlocks";
import DuplicateCleanup from "@/app/components/library/DuplicateCleanup";
import Sheet from "@/app/components/ui/Sheet";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import { iconButtonClass } from "@/app/components/ui/IconButton";
import { AlbumsIcon, DuplicateIcon, FolderIcon, PlusIcon, RefreshIcon, TrashIcon } from "@/app/components/library/icons";

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

/** A section of the screen: a title, an optional count and an action. */
function Section({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex min-h-9 items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="truncate text-title text-ink">{title}</h2>
          {meta !== undefined && <span className="shrink-0 text-footnote tabular-nums text-ink-muted">{meta}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const coverLinkClass =
  "pressable group relative isolate block overflow-hidden rounded-[20px] bg-surface-2";
const coverImageClass =
  "absolute inset-0 h-full w-full object-cover transition-transform duration-380 ease-lumen group-hover:scale-[1.04]";

/** A cover card's caption: name and count in white over a bottom scrim (or on the tile). */
function CoverCaption({ name, count, onPhoto }: { name: string; count: string; onPhoto: boolean }) {
  return (
    <>
      {onPhoto && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3 sm:p-3.5">
        <p className={`line-clamp-2 break-words text-headline ${onPhoto ? "text-white" : "text-ink"}`}>{name}</p>
        <p className={`text-footnote font-medium tabular-nums ${onPhoto ? "text-white/80" : "text-ink-muted"}`}>{count}</p>
      </div>
    </>
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
    <Link href={albumHref(album.id)} onClick={() => rememberAlbumListOrigin(album.id)} className={`${coverLinkClass} aspect-square`}>
      {coverId ? (
        <GalleryThumb
          repoKey={repoKey}
          mediaId={coverId}
          alt=""
          size={800}
          hasThumbnail={cover ? Boolean(cover.thumb) : true}
          isVideo={cover?.mimeType.startsWith("video/")}
          className={coverImageClass}
        />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center pb-10 text-ink-muted">
          <AlbumsIcon size={32} />
        </span>
      )}
      <CoverCaption name={album.name} count={countLabel(count)} onPhoto={Boolean(coverId)} />
    </Link>
  );
}

function CategoryCard({ category, repoKey }: { category: Category; repoKey: string }) {
  const cover = categoryCover(category.items);
  return (
    <Link
      href={categoryHref(category.id)}
      onClick={() => rememberAlbumListOrigin(`category:${category.id}`)}
      className={`${coverLinkClass} aspect-[5/4]`}
    >
      {cover ? (
        <GalleryThumb
          repoKey={repoKey}
          mediaId={cover.id}
          alt=""
          size={800}
          hasThumbnail={Boolean(cover.thumb)}
          isVideo={cover.mimeType.startsWith("video/")}
          className={coverImageClass}
        />
      ) : (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center pb-8 text-ink-muted">
          <FolderIcon size={26} />
        </span>
      )}
      <CoverCaption name={category.name} count={category.items.length.toLocaleString()} onPhoto={Boolean(cover)} />
    </Link>
  );
}

const CATEGORY_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4";
const ALBUM_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5";

/** Library: People, automatic categories, the user's albums, and Trash. */
export default function AlbumsClient({ repoOwner, repoName }: AlbumsClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const library = useLibrary(repoKey);
  const albumsState = useAlbums(repoKey);
  const [creating, setCreating] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);

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
          <li key={i} className="skeleton aspect-square rounded-[20px]" />
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
            className="pressable group relative block aspect-square w-full rounded-[20px] bg-accent-soft text-left"
          >
            <span className="absolute inset-0 flex items-center justify-center pb-10">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-glow-signal transition-transform duration-240 ease-spring group-hover:scale-105">
                <PlusIcon size={22} strokeWidth={2.2} />
              </span>
            </span>
            <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3 sm:p-3.5">
              <span className="text-headline text-ink">New album</span>
              <span className="text-footnote text-accent-text">{albums.length === 0 ? "Group photos" : "Add one"}</span>
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
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i} className="skeleton aspect-[5/4] rounded-[20px]" />
        ))}
      </ul>
    );
  } else {
    categoriesContent = null;
  }

  const trashCount = library.trashed.length;
  const facts =
    albumsLoading && libraryLoading
      ? null
      : [
          albums.length === 1 ? "1 album" : `${albums.length.toLocaleString()} albums`,
          categories.length > 0 ? `${categories.length.toLocaleString()} categories` : null,
        ];

  return (
    <>
      <ScrollArea scrollKey="albums">
        <PageHeader
          title="Albums"
          telemetry={facts ? <Telemetry items={facts} /> : <span className="skeleton block h-3 w-32 rounded-full" />}
          actions={
            <button
              type="button"
              onClick={() => setCreating(true)}
              aria-label="New album"
              title="New album"
              className={`${iconButtonClass({ variant: "tile", size: 40 })} sm:w-auto sm:gap-2 sm:px-4`}
            >
              <PlusIcon size={18} />
              <span className="hidden text-callout font-semibold sm:inline">New album</span>
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
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-9 px-4 pb-4 pt-3 sm:px-6 lg:px-8">
          <PeopleRow repoKey={repoKey} />

          {categoriesContent && (
            <Section title="Categories" meta={categories.length > 0 ? categories.length.toLocaleString() : undefined}>
              {categoriesContent}
            </Section>
          )}

          <Section title="Your albums" meta={albumsLoading ? undefined : albums.length.toLocaleString()}>
            {albumsContent}
          </Section>

          <SettingsCard className="animate-fade-in">
            <SettingsRow
              href="/albums/trash"
              onClick={() => rememberAlbumListOrigin("trash")}
              icon={<TrashIcon size={18} />}
              iconTone="danger"
              title="Trash"
              description={
                trashCount > 0
                  ? `${countLabel(trashCount)} · kept for ${TRASH_RETENTION_DAYS} days`
                  : `Deleted items stay here for ${TRASH_RETENTION_DAYS} days`
              }
            />
            <SettingsRow
              onClick={() => setDuplicatesOpen(true)}
              icon={<DuplicateIcon size={18} />}
              iconTone="orange"
              title="Duplicates"
              description="Extra copies of the same photo or video"
            />
          </SettingsCard>
        </div>
      </ScrollArea>

      <Sheet open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} title="Duplicates">
        <DuplicateCleanup repoKey={repoKey} />
      </Sheet>

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
