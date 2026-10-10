"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { useBackupStatus, useLibrary, useOnline } from "@/lib/library/hooks";
import { syncLibrary } from "@/lib/library/mediaStore";
import { galleryView, type LibraryFilter } from "@/lib/library/viewState";
import EmptyState, { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import MediaLibraryView from "@/app/components/library/MediaLibraryView";
import Notice, { noticeActionClass } from "@/app/components/library/Notice";
import { RefreshIcon, UploadIcon } from "@/app/components/library/icons";
import GalleryHeader from "./GalleryHeader";

interface GalleryClientProps {
  repoOwner: string;
  repoName: string;
}

function applyFilter(items: MediaIndexEntry[], filter: LibraryFilter, query: string): MediaIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (filter === "all" && !q) return items;
  return items.filter((item) => {
    if (filter === "photos" && !item.mimeType.startsWith("image/")) return false;
    if (filter === "videos" && !item.mimeType.startsWith("video/")) return false;
    if (filter === "favorites" && !item.favorite) return false;
    return !q || item.filename.toLowerCase().includes(q);
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
  const deferredQuery = useDeferredValue(query);

  const setFilter = (next: LibraryFilter) => {
    galleryView.filter = next;
    setFilterState(next);
  };
  const setQuery = (next: string) => {
    galleryView.query = next;
    setQueryState(next);
  };

  useEffect(() => {
    if (library.error?.kind === "auth") router.replace("/");
  }, [library.error, router]);

  const visible = useMemo(
    () => applyFilter(library.items, filter, deferredQuery),
    [library.items, filter, deferredQuery]
  );

  const hasLibrary = library.items.length > 0;
  const offline = !online || library.error?.kind === "offline";
  const loading = !hasLibrary && (!library.hydrated || (!library.synced && !library.error));
  const retry = () => void syncLibrary();

  const notice =
    hasLibrary && library.error && library.error.kind !== "auth" && library.error.kind !== "offline" ? (
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
        message={`Nothing in ${filter === "all" ? "your library" : `your ${filter}`} is named like “${deferredQuery.trim()}”.`}
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

  return (
    <MediaLibraryView
      repoKey={repoKey}
      scrollKey="gallery"
      items={visible}
      loading={loading}
      notice={notice}
      empty={empty}
      resetKey={`${filter}|${deferredQuery}`}
      header={({ selectMode, startSelect }) => (
        <GalleryHeader
          filter={filter}
          onFilterChange={setFilter}
          query={query}
          onQueryChange={setQuery}
          searchOpen={searchOpen}
          onSearchOpenChange={setSearchOpen}
          offline={offline}
          canSelect={visible.length > 0}
          selectMode={selectMode}
          onSelect={startSelect}
        />
      )}
    />
  );
}
