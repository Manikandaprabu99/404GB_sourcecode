"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { removeTerm, type SearchTerm, type Suggestions } from "@/lib/library/search";
import type { LibraryFilter } from "@/lib/library/viewState";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { setZoom, useZoom, ZOOM_LABELS, ZOOM_LEVELS } from "@/lib/library/zoom";
import BackupStatusPill, { StatusPill } from "@/app/components/backup/BackupStatusPill";
import SmartSearchField from "@/app/components/search/SmartSearchField";
import {
  AlbumsIcon,
  BackIcon,
  CalendarIcon,
  CloseIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  PersonIcon,
  PhotosIcon,
  SearchIcon,
  ViewGridIcon,
} from "@/app/components/library/icons";

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
  { value: "favorites", label: "Favorites" },
];

interface GalleryHeaderProps {
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Phone search mode (the title row turns into a search field). */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  offline: boolean;
  canSelect: boolean;
  selectMode: boolean;
  onSelect: () => void;
  repoKey: string;
  entriesById: ReadonlyMap<string, MediaIndexEntry>;
  suggest: (query: string) => Suggestions;
  /** What the query was understood as, shown as removable chips. */
  terms: SearchTerm[];
  onSearchFocus?: () => void;
}

function termIcon(term: SearchTerm): ReactNode {
  switch (term.kind) {
    case "person":
      return <PersonIcon size={13} />;
    case "album":
      return <AlbumsIcon size={13} />;
    case "category":
      return <FolderIcon size={13} />;
    case "range":
    case "month":
      return <CalendarIcon size={13} />;
    case "favorite":
      return <HeartIcon size={13} />;
    case "edited":
      return <PencilIcon size={13} />;
    case "type":
      return <PhotosIcon size={13} />;
    default:
      return <SearchIcon size={13} />;
  }
}

export default function GalleryHeader({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  searchOpen,
  onSearchOpenChange,
  offline,
  canSelect,
  selectMode,
  onSelect,
  repoKey,
  entriesById,
  suggest,
  terms,
  onSearchFocus,
}: GalleryHeaderProps) {
  const desktopSearchRef = useRef<HTMLInputElement>(null);

  const closeSearch = () => {
    onSearchOpenChange(false);
    onQueryChange("");
  };
  useHistoryOverlay(searchOpen, closeSearch);

  // "/" jumps to search on desktop, like most web apps.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const input = desktopSearchRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const zoom = useZoom();
  const nextZoom = ZOOM_LEVELS[(ZOOM_LEVELS.indexOf(zoom) + 1) % ZOOM_LEVELS.length];
  const zoomButton = canSelect && !selectMode ? (
    <button
      type="button"
      onClick={() => setZoom(nextZoom)}
      aria-label={`${ZOOM_LABELS[zoom]} view. Switch to ${ZOOM_LABELS[nextZoom].toLowerCase()} view`}
      title="Change view (pinch, or Ctrl + scroll)"
      className="flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink active:bg-surface-3 sm:h-9 sm:px-3"
    >
      <ViewGridIcon size={18} density={zoom === "day" ? 2 : zoom === "month" ? 3 : 4} />
      <span key={zoom} className="hidden animate-fade-in text-small font-medium sm:inline">
        {ZOOM_LABELS[zoom]}
      </span>
    </button>
  ) : null;

  const selectButton =
    canSelect && !selectMode ? (
      <button
        type="button"
        onClick={onSelect}
        className="h-9 shrink-0 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2 active:bg-surface-3"
      >
        Select
      </button>
    ) : null;

  return (
    <div className="relative bg-bg pt-safe sm:pt-0">
      {searchOpen && (
        <div className="flex h-12 animate-fade-in items-center gap-1 px-1.5 sm:hidden">
          <button
            type="button"
            onClick={closeSearch}
            aria-label="Close search"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          >
            <BackIcon size={20} />
          </button>
          <SmartSearchField
            variant="phone"
            autoFocus
            query={query}
            onQueryChange={onQueryChange}
            suggest={suggest}
            repoKey={repoKey}
            entriesById={entriesById}
            onFocus={onSearchFocus}
          />
          {selectButton}
        </div>
      )}

      <div
        className={`h-12 items-center gap-2 pl-4 pr-1.5 sm:flex sm:h-14 sm:px-6 ${searchOpen ? "hidden" : "flex"}`}
      >
        <h1 className="shrink-0 text-h3 font-semibold tracking-tight text-ink">Photos</h1>
        <div className="flex min-w-0 flex-1 items-center pl-1">
          {offline ? <StatusPill label="Offline" tone="muted" icon="off" /> : <BackupStatusPill />}
        </div>

        <SmartSearchField
          ref={desktopSearchRef}
          variant="desktop"
          query={query}
          onQueryChange={onQueryChange}
          suggest={suggest}
          repoKey={repoKey}
          entriesById={entriesById}
          onFocus={onSearchFocus}
        />

        <button
          type="button"
          onClick={() => onSearchOpenChange(true)}
          aria-label="Search"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink sm:hidden"
        >
          <SearchIcon size={20} />
        </button>
        {zoomButton}
        {selectButton}
      </div>

      <div
        role="radiogroup"
        aria-label="Show"
        className="flex h-11 items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
      >
        {FILTERS.map(({ value, label }) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onFilterChange(value)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-small font-medium transition-[background-color,color,transform] duration-180 ease-out-expo active:scale-95 ${
                active ? "bg-ink text-bg" : "bg-surface-2 text-ink-muted hover:text-ink"
              }`}
            >
              {value === "favorites" && <HeartIcon size={14} filled={active} />}
              {label}
            </button>
          );
        })}
        {terms.length > 0 && (
          <>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border" />
            <ul aria-label="Searching for" className="flex items-center gap-1.5">
              {terms.map((term) => (
                <li key={`${term.kind}:${term.start}`} className="animate-scale-in">
                  <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 pl-2.5 pr-1 text-small font-medium text-ink">
                    <span className="text-accent">{termIcon(term)}</span>
                    <span className="max-w-[12rem] truncate">{term.label}</span>
                    <button
                      type="button"
                      onClick={() => onQueryChange(removeTerm(query, term))}
                      aria-label={`Remove ${term.label}`}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-accent/15 hover:text-ink"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
