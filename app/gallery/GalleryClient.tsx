"use client";

import "./gallery.css";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { useFaceScanStatus, usePeople, type Person } from "@/lib/faces/people";
import { albumCoverId } from "@/lib/library/albumsStore";
import { buildCategories, categoryCover } from "@/lib/library/categories";
import { afterOverlayClosed } from "@/lib/library/history";
import { useAlbums, useBackupStatus, useLibrary, useOnline } from "@/lib/library/hooks";
import { syncLibrary } from "@/lib/library/mediaStore";
import { spotlight, type Spotlight } from "@/lib/library/memories";
import {
  compileQuery,
  libraryFacts,
  matchesType,
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
import type { DateGroup } from "./dateGroups";
import { GalleryBar, GalleryIntro, QuickRail, type GalleryFilter, type GalleryHeaderProps, type RailInfo } from "./GalleryHeader";
import MemoriesStrip from "./MemoriesStrip";
import StoryPlayer from "./story/StoryPlayer";
import type { GroupPerson } from "./VirtualGrid";
import { formatBytes } from "./viewer/format";

interface GalleryClientProps {
  repoOwner: string;
  repoName: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Recently added": uploaded in the last 30 days. */
const RECENT_DAYS = 30;

// The rail's collections that lib/library/viewState has no word for live here (module scope,
// so a tab switch keeps them like the rest of galleryView).
let savedFilter: GalleryFilter = galleryView.filter;

const FILTER_NOUN: Partial<Record<GalleryFilter, [string, string]>> = {
  photos: ["photo", "photos"],
  videos: ["video", "videos"],
  favorites: ["favorite", "favorites"],
  screenshots: ["screenshot", "screenshots"],
  selfies: ["selfie", "selfies"],
};

/** The subtitle's count: what the grid shows, in the words of the filter or search. */
function countFact(count: number, filter: GalleryFilter, searching: boolean): string {
  const n = count.toLocaleString();
  if (searching) return count === 1 ? "1 match" : `${n} matches`;
  const noun = FILTER_NOUN[filter] ?? ["item", "items"];
  return count === 1 ? `1 ${noun[0]}` : `${n} ${noun[1]}`;
}

/** The rail's filter and the search query together (lib/library/search explains the query). */
function applyFilter(
  items: MediaIndexEntry[],
  filter: GalleryFilter,
  parsed: ParsedQuery,
  screenshotIds: ReadonlySet<string>,
  now: Date
): MediaIndexEntry[] {
  const matches = compileQuery(parsed);
  if (filter === "all" && !matches) return items;
  const recentSince = now.getTime() - RECENT_DAYS * DAY_MS;
  return items.filter((item) => {
    if (filter === "photos" && !item.mimeType.startsWith("image/")) return false;
    if (filter === "videos" && !item.mimeType.startsWith("video/")) return false;
    if (filter === "favorites" && !item.favorite) return false;
    if (filter === "screenshots" && !screenshotIds.has(item.id)) return false;
    if (filter === "selfies" && !matchesType(item, "selfie")) return false;
    if (filter === "recent") {
      const added = Date.parse(item.createdAt);
      if (Number.isNaN(added) || added < recentSince) return false;
    }
    return !matches || matches(item);
  });
}

/** Placeholders in the hero's and rail's shapes while a cold load runs (the grid's follow). */
function HeroSkeleton() {
  return (
    <div aria-hidden="true" className="animate-fade-in px-4 pb-1 pt-1 sm:px-6">
      <div className="skeleton aspect-[4/5] max-h-[min(30rem,58vh)] w-full rounded-[26px] sm:aspect-[21/9] sm:max-h-[27.5rem]" />
      <div className="flex h-6 items-center justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="skeleton block h-1.5 w-1.5 rounded-full" />
        ))}
      </div>
      <div className="flex h-12 items-center gap-2 overflow-hidden">
        {[52, 96, 78, 112, 124].map((w, i) => (
          <span key={i} className="skeleton block h-9 shrink-0 rounded-full" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

export default function GalleryClient({ repoOwner, repoName }: GalleryClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const library = useLibrary(repoKey);
  const backup = useBackupStatus();
  const online = useOnline();
  const [filter, setFilterState] = useState<GalleryFilter>(savedFilter);
  const [query, setQueryState] = useState(galleryView.query);
  const [searchOpen, setSearchOpen] = useState(false);
  const desktopSearchRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const zoom = useZoom();
  const { people } = usePeople(repoKey);
  const scan = useFaceScanStatus();
  const [story, setStory] = useState<Spotlight | null>(null);
  const openSetRef = useRef<(setKey: string, id: string) => void>(() => {});
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

  const setFilter = (next: GalleryFilter) => {
    savedFilter = next;
    const basic: LibraryFilter[] = ["all", "photos", "videos", "favorites"];
    galleryView.filter = (basic as string[]).includes(next) ? (next as LibraryFilter) : "all";
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
  const screenshotIds = useMemo(
    () => new Set((categories.find((category) => category.id === "screenshots")?.items ?? []).map((item) => item.id)),
    [categories]
  );
  const hasSelfies = useMemo(() => library.items.some((item) => matchesType(item, "selfie")), [library.items]);
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

  const visible = useMemo(
    () => applyFilter(library.items, filter, parsed, screenshotIds, now),
    [library.items, filter, parsed, screenshotIds, now]
  );
  const visibleBytes = useMemo(() => visible.reduce((sum, item) => sum + (item.size ?? 0), 0), [visible]);

  const spotlights = useMemo(() => spotlight(library.items, now, people), [library.items, now, people]);
  const memorySets = useMemo(
    () => Object.fromEntries(spotlights.map((spot) => [`memory:${spot.key}`, spot.items])),
    [spotlights]
  );
  const showHero = filter === "all" && !deferredQuery.trim() && !searchOpen;

  // Day headers' avatar stacks: who appears in each day's photos, worked out once per group.
  const groupPeople = useMemo(() => {
    if (people.length === 0) return undefined;
    const byMedia = new Map<string, Person[]>();
    for (const person of people) {
      for (const id of person.mediaIds) {
        const list = byMedia.get(id);
        if (list) list.push(person);
        else byMedia.set(id, [person]);
      }
    }
    const cache = new WeakMap<DateGroup, GroupPerson[]>();
    return (group: DateGroup): GroupPerson[] => {
      const known = cache.get(group);
      if (known) return known;
      const counts = new Map<Person, number>();
      for (const item of group.items) {
        for (const person of byMedia.get(item.id) ?? []) counts.set(person, (counts.get(person) ?? 0) + 1);
      }
      const result = Array.from(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([person]) => ({
          id: person.id,
          cover: person.cover,
          entry: person.cover ? entriesById.get(person.cover.mediaId) : undefined,
        }));
      cache.set(group, result);
      return result;
    };
  }, [people, entriesById]);

  const hasLibrary = library.items.length > 0;
  const offline = !online || library.error?.kind === "offline";
  const loading = !hasLibrary && (!library.hydrated || (!library.synced && !library.error));
  const retry = () => void syncLibrary();

  // `1,443 items · 17.8 GB` (or what a filter or search shows); nothing yet during a cold load.
  const subtitle = loading
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

  const filterNoun = FILTER_NOUN[filter]?.[1] ?? (filter === "recent" ? "recently added items" : "library");
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
        message={`Nothing in ${filter === "all" ? "your library" : `your ${filterNoun}`} matches “${deferredQuery.trim()}”. Try a name, an app like WhatsApp, a date like “October 2024”, or part of a file name.`}
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
  } else if (filter === "screenshots") {
    empty = <EmptyState illustration="photos" title="No screenshots" message="Screenshots you back up show up here." />;
  } else if (filter === "selfies") {
    empty = <EmptyState illustration="photos" title="No selfies" message="Selfies show up here when your phone marks them as selfies." />;
  } else if (filter === "recent") {
    empty = (
      <EmptyState illustration="photos" title="Nothing added lately" message={`Photos and videos added in the last ${RECENT_DAYS} days show up here.`} />
    );
  } else {
    empty = <EmptyState illustration="photos" title="No photos yet" message="Photos you back up or upload show up here." />;
  }

  const rail: RailInfo = { hasScreenshots: screenshotIds.size > 0, hasSelfies, people, scan, entriesById };
  const headerProps = ({ selectMode, startSelect, collapsed }: LibraryHeaderState): GalleryHeaderProps => ({
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
    subtitle,
    collapsed,
    desktopSearchRef,
    rail,
    libraryEmpty: !hasLibrary,
  });

  return (
    <>
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
        groupPeople={groupPeople}
        aboveGrid={({ selectMode, openSet, loading: cold }) => {
          openSetRef.current = openSet;
          if (cold) return <HeroSkeleton />;
          if (!hasLibrary) return null;
          const props = headerProps({ selectMode, startSelect: () => {}, collapsed: false, headerHeight: 0 });
          return (
            <>
              {showHero && (
                <MemoriesStrip spotlights={spotlights} repoKey={repoKey} zoom={zoom} disabled={selectMode} onPlay={setStory} />
              )}
              {!searchOpen && (
                <div className="px-4 pb-1 sm:px-6">
                  <QuickRail {...props} />
                </div>
              )}
            </>
          );
        }}
        header={(state) => <GalleryBar {...headerProps(state)} />}
        intro={(state) => <GalleryIntro {...headerProps(state)} />}
      />
      {story && (
        <StoryPlayer
          key={story.key}
          spotlight={story}
          repoKey={repoKey}
          onClose={() => setStory(null)}
          onOpenItem={(id) => {
            const key = `memory:${story.key}`;
            afterOverlayClosed(() => openSetRef.current(key, id));
          }}
        />
      )}
    </>
  );
}
