"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { usePeople } from "@/lib/faces/people";
import { albumCoverId } from "@/lib/library/albumsStore";
import { buildCategories, categoryCover } from "@/lib/library/categories";
import { useAlbums, useBackupStatus, useLibrary, useOnline } from "@/lib/library/hooks";
import { syncLibrary } from "@/lib/library/mediaStore";
import { onThisDay } from "@/lib/library/memories";
import {
  compileQuery,
  libraryFacts,
  parseQuery,
  suggest as suggestFor,
  type ParsedQuery,
  type SearchContext,
} from "@/lib/library/search";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import { localDayKey } from "@/lib/library/trash";
import { galleryView, type LibraryFilter } from "@/lib/library/viewState";
import { useZoom } from "@/lib/library/zoom";
import EmptyState, { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import MediaLibraryView, { type LibraryHeaderState } from "@/app/components/library/MediaLibraryView";
import Notice, { noticeActionClass } from "@/app/components/library/Notice";
import { RefreshIcon, UploadIcon } from "@/app/components/library/icons";
import { GalleryBar, GalleryIntro, type GalleryHeaderProps } from "./GalleryHeader";
import MemoriesStrip from "./MemoriesStrip";
import { formatBytes } from "./viewer/format";

interface GalleryClientProps {
  repoOwner: string;
  repoName: string;
}

/** The telemetry line's count: what the grid shows, in the words of the filter or search. */
function countFact(count: number, filter: LibraryFilter, searching: boolean): string {
  const n = count.toLocaleString();
  if (searching) return count === 1 ? "1 match" : `${n} matches`;
  switch (filter) {
    case "photos":
      return count === 1 ? "1 photo" : `${n} photos`;
    case "videos":
      return count === 1 ? "1 video" : `${n} videos`;
    case "favorites":
      return count === 1 ? "1 favorite" : `${n} favorites`;
    default:
      return count === 1 ? "1 item" : `${n} items`;
  }
}

/** The filter chip and the search query together (lib/library/search explains the query). */
function applyFilter(items: MediaIndexEntry[], filter: LibraryFilter, parsed: ParsedQuery): MediaIndexEntry[] {
  const matches = compileQuery(parsed);
  if (filter === "all" && !matches) return items;
  return items.filter((item) => {
    if (filter === "photos" && !item.mimeType.startsWith("image/")) return false;
    if (filter === "videos" && !item.mimeType.startsWith("video/")) return false;
    if (filter === "favorites" && !item.favorite) return false;
    return !matches || matches(item);
  });
}

export default function GalleryClient({ repoOwner, repoName }: GalleryClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const library = useLibrary(repoKey);
  const backup = useBackupStatus();
  const online = useOnline();
  const [filter, setFilterState] = useState<LibraryFilter>(galleryView.filter);
  const [query, setQueryState] = useState(galleryView.query);
  const [searchOpen, setSearchOpen] = useState(false);
  // The search field scrolled up under the sticky bar (the bar then offers a search button).
  const [searchFieldHidden, setSearchFieldHidden] = useState(false);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const zoom = useZoom();
  const { people } = usePeople(repoKey);
  // Album names matter only for search: the cached list until search is first used.
  const [searchUsed, setSearchUsed] = useState(() => galleryView.query.trim() !== "");
  const albumsState = useAlbums(repoKey, { load: searchUsed });
  // "Today", "last week" and On this day move on when the app comes back on another day.
  const [day, setDay] = useState(() => localDayKey(new Date()));
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setDay(localDayKey(new Date()));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const setFilter = (next: LibraryFilter) => {
    galleryView.filter = next;
    setFilterState(next);
  };
  const setQuery = (next: string) => {
    galleryView.query = next;
    setQueryState(next);
  };

  useEffect(() => {
    const action = signedOutAction(library.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [library.error, router]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new "now" only when the day changes
  const now = useMemo(() => new Date(), [day]);
  const trashedIds = useMemo(() => new Set(library.trashed.map((item) => item.id)), [library.trashed]);
  const categories = useMemo(() => buildCategories(library.items), [library.items]);
  const searchContext = useMemo<SearchContext>(
    () => ({
      people: people.flatMap((person) =>
        person.name ? [{ id: person.id, name: person.name, mediaIds: person.mediaIds, cover: person.cover }] : []
      ),
      albums: albumsState.albums.map((album) => ({
        id: album.id,
        name: album.name,
        mediaIds: album.mediaIds.filter((id) => !trashedIds.has(id)),
        coverId: albumCoverId(album, trashedIds),
      })),
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        count: category.items.length,
        coverId: categoryCover(category.items)?.id,
      })),
      now,
    }),
    [people, albumsState.albums, trashedIds, categories, now]
  );
  const facts = useMemo(() => libraryFacts(library.items), [library.items]);
  const suggest = useCallback((text: string) => suggestFor(text, searchContext, facts), [searchContext, facts]);
  const parsed = useMemo(() => parseQuery(deferredQuery, searchContext), [deferredQuery, searchContext]);
  const entriesById = useMemo(() => new Map(library.items.map((item) => [item.id, item])), [library.items]);

  const visible = useMemo(() => applyFilter(library.items, filter, parsed), [library.items, filter, parsed]);
  const visibleBytes = useMemo(() => visible.reduce((sum, item) => sum + (item.size ?? 0), 0), [visible]);

  const memories = useMemo(() => onThisDay(library.items, now), [library.items, now]);
  const memorySets = useMemo(
    () => Object.fromEntries(memories.map((memory) => [`memory:${memory.key}`, memory.items])),
    [memories]
  );
  const showMemories = filter === "all" && !deferredQuery.trim();

  const hasLibrary = library.items.length > 0;
  const offline = !online || library.error?.kind === "offline";
  const loading = !hasLibrary && (!library.hydrated || (!library.synced && !library.error));
  const retry = () => void syncLibrary();

  // `12,431 ITEMS · 38.2 GB` (or what a filter or search shows), plus BACKING UP while the
  // phone uploads (the header adds it where there's room); nothing yet during a cold load.
  const backingUp = backup.support === "available" && Boolean(backup.status?.enabled) && backup.status?.state === "uploading";
  const telemetry = loading
    ? null
    : [countFact(visible.length, filter, deferredQuery.trim() !== ""), visibleBytes > 0 ? formatBytes(visibleBytes) : null].filter(
        (fact): fact is string => Boolean(fact)
      );

  const notice =
    hasLibrary && library.error?.kind === "auth" && library.error.code !== "no_repo" ? (
      <Notice
        action={
          <button type="button" onClick={() => leaveForSignIn()} className={noticeActionClass}>
            Sign in
          </button>
        }
      >
        You&apos;re signed out. Sign in again to see new photos and keep backing up.
      </Notice>
    ) : hasLibrary && library.error && library.error.kind !== "auth" && library.error.kind !== "offline" ? (
      <Notice
        action={
          <button type="button" onClick={retry} className={noticeActionClass}>
            Retry
          </button>
        }
      >
        {library.error.kind === "rate-limit"
          ? library.error.message
          : "Couldn't refresh your library. Showing what's saved on this device."}
      </Notice>
    ) : null;

  let empty: JSX.Element;
  if (!hasLibrary && library.error && library.error.kind !== "auth") {
    empty =
      library.error.kind === "offline" ? (
        <EmptyState
          illustration="offline"
          title="You're offline"
          message="Your library will show up here once you're back online."
        >
          <button type="button" onClick={retry} className={secondaryButtonClass}>
            <RefreshIcon size={16} />
            Try again
          </button>
        </EmptyState>
      ) : (
        <EmptyState illustration="error" title="Couldn't load your library" message={library.error.message}>
          <button type="button" onClick={retry} className={primaryButtonClass}>
            <RefreshIcon size={16} />
            Retry
          </button>
        </EmptyState>
      );
  } else if (!hasLibrary) {
    const status = backup.status;
    const backingUp = backup.support === "available" && status?.enabled && status.state !== "off";
    empty = (
      <EmptyState
        illustration="photos"
        title={backingUp ? "Your photos are on their way" : "Your library is empty"}
        message={
          backingUp
            ? "Backup is on. Photos and videos appear here as soon as they're uploaded."
            : backup.support === "available"
              ? "Turn on backup to keep every photo and video from this phone safe in your GitHub repo, in original quality."
              : "Upload photos and videos to keep them safe in your GitHub repo, in original quality."
        }
      >
        {backup.support === "available" && !backingUp && (
          <Link href="/settings" className={primaryButtonClass}>
            Turn on backup
          </Link>
        )}
        <Link
          href="/upload"
          className={backup.support === "available" && !backingUp ? secondaryButtonClass : primaryButtonClass}
        >
          <UploadIcon size={16} />
          Upload
        </Link>
      </EmptyState>
    );
  } else if (deferredQuery.trim()) {
    empty = (
      <EmptyState
        illustration="search"
        title="No matches"
        message={`Nothing in ${filter === "all" ? "your library" : `your ${filter}`} matches “${deferredQuery.trim()}”. Try a name, an app like WhatsApp, a date like “October 2024”, or part of a file name.`}
      >
        <button type="button" onClick={() => setQuery("")} className={secondaryButtonClass}>
          Clear search
        </button>
      </EmptyState>
    );
  } else if (filter === "favorites") {
    empty = (
      <EmptyState
        illustration="favorites"
        title="No favorites yet"
        message="Tap the heart on a photo or video to find it here quickly."
      />
    );
  } else if (filter === "videos") {
    empty = <EmptyState illustration="videos" title="No videos yet" message="Videos you back up or upload show up here." />;
  } else {
    empty = <EmptyState illustration="photos" title="No photos yet" message="Photos you back up or upload show up here." />;
  }

  const headerProps = ({ selectMode, startSelect, collapsed, headerHeight }: LibraryHeaderState): GalleryHeaderProps => ({
    filter,
    onFilterChange: setFilter,
    query,
    onQueryChange: setQuery,
    searchOpen,
    onSearchOpenChange: setSearchOpen,
    offline,
    canSelect: visible.length > 0,
    selectMode,
    onSelect: startSelect,
    repoKey,
    entriesById,
    suggest,
    terms: deferredQuery.trim() ? parsed.terms.filter((term) => term.kind !== "text") : [],
    onSearchFocus: () => setSearchUsed(true),
    telemetry,
    backingUp,
    collapsed,
    headerHeight,
    fieldHidden: searchFieldHidden,
    onFieldHiddenChange: setSearchFieldHidden,
    desktopSearchRef,
  });

  return (
    <MediaLibraryView
      repoKey={repoKey}
      scrollKey="gallery"
      contained
      items={visible}
      loading={loading}
      notice={notice}
      empty={empty}
      resetKey={`${filter}|${deferredQuery}`}
      viewerSets={memorySets}
      aboveGrid={({ selectMode, openSet }) =>
        showMemories ? (
          <MemoriesStrip
            memories={memories}
            repoKey={repoKey}
            zoom={zoom}
            disabled={selectMode}
            onOpen={(memory) => openSet(`memory:${memory.key}`, memory.items[0].id)}
          />
        ) : null
      }
      header={(state) => <GalleryBar {...headerProps(state)} />}
      intro={(state) => <GalleryIntro {...headerProps(state)} />}
    />
  );
}
