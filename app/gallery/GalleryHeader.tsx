"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { removeTerm, type SearchTerm, type Suggestions } from "@/lib/library/search";
import { SCROLL_TOP_EVENT, type LibraryFilter } from "@/lib/library/viewState";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { setZoom, useZoom, ZOOM_LABELS, ZOOM_LEVELS } from "@/lib/library/zoom";
import BackupStatusPill, { StatusPill } from "@/app/components/backup/BackupStatusPill";
import SmartSearchField, { SEARCH_FIELD_CLASS, SEARCH_PLACEHOLDER } from "@/app/components/search/SmartSearchField";
import Chip, { TermChip } from "@/app/components/ui/Chip";
import IconButton, { iconButtonClass } from "@/app/components/ui/IconButton";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import {
  AlbumsIcon,
  BackIcon,
  CalendarIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  PersonIcon,
  PhotosIcon,
  SearchIcon,
  SelectIcon,
  ViewGridIcon,
} from "@/app/components/library/icons";

const FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
  { value: "favorites", label: "Favorites" },
];

export interface GalleryHeaderProps {
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
  /** The telemetry line's facts (`12,431 items`, `38.2 GB`); null while the library loads. */
  telemetry: string[] | null;
  /** The phone is backing up: wide screens add BACKING UP to the telemetry line (on phones the
   * status badge sits on that line and says it). */
  backingUp: boolean;
  /** Scrolled a little: the large title gives way to the compact bar. */
  collapsed: boolean;
  /** Height of the sticky bar (px), for telling when the search field is under it. */
  headerHeight: number;
  /** The search field has scrolled away under the bar: the bar offers a search button. */
  fieldHidden: boolean;
  onFieldHiddenChange: (hidden: boolean) => void;
  /** The desktop search input (in the intro), for "/" and the bar's search button. */
  desktopSearchRef: RefObject<HTMLInputElement>;
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

/** The backup (or offline) status badge. */
function HeaderBadge({ offline }: { offline: boolean }) {
  return offline ? <StatusPill label="Offline" tone="muted" icon="off" /> : <BackupStatusPill />;
}

/** Scrolls the screen back to the top and puts the cursor in the desktop search field. */
function focusDesktopSearch(input: HTMLInputElement | null, fieldHidden: boolean) {
  if (!input || input.offsetParent === null) return;
  if (fieldHidden) window.dispatchEvent(new Event(SCROLL_TOP_EVENT));
  input.focus({ preventScroll: fieldHidden });
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/** Filter chips plus the terms the query was understood as (one row, scrolling sideways on phones). */
function FilterChips({ filter, onFilterChange, terms, query, onQueryChange }: GalleryHeaderProps) {
  return (
    <div className="-mx-4 flex h-11 items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
      <div role="radiogroup" aria-label="Show" className="flex shrink-0 items-center gap-2">
        {FILTERS.map(({ value, label }) => {
          const active = filter === value;
          return (
            <Chip
              key={value}
              role="radio"
              selected={active}
              onClick={() => onFilterChange(value)}
              icon={value === "favorites" ? <HeartIcon size={14} filled={active} /> : undefined}
            >
              {label}
            </Chip>
          );
        })}
      </div>
      {terms.length > 0 && (
        <>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-border-strong" />
          <ul aria-label="Searching for" className="flex shrink-0 items-center gap-1.5">
            {terms.map((term) => (
              <li key={`${term.kind}:${term.start}`} className="animate-scale-in">
                <TermChip icon={termIcon(term)} label={term.label} onRemove={() => onQueryChange(removeTerm(query, term))} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * The Photos header's sticky bar (docs/DESIGN.md › Screens › Photos): the large `Photos` title
 * with the status badge, the view and Select buttons; after a little scroll it collapses into
 * the compact blurred bar. On phones the search mode replaces it with the search field (and
 * keeps the filter chips pinned under it).
 */
export function GalleryBar(props: GalleryHeaderProps) {
  const {
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
    onSearchFocus,
    collapsed,
    fieldHidden,
    desktopSearchRef,
  } = props;
  const fieldHiddenRef = useRef(fieldHidden);
  fieldHiddenRef.current = fieldHidden;

  const closeSearch = () => {
    onSearchOpenChange(false);
    onQueryChange("");
  };
  useHistoryOverlay(searchOpen, closeSearch);

  // The search mode is a phone layout: a window widening past it leaves it (keeping the query),
  // so the filter chips are only ever in one place.
  useEffect(() => {
    if (!searchOpen) return;
    const media = window.matchMedia("(min-width: 640px)");
    const onChange = () => {
      if (media.matches) onSearchOpenChange(false);
    };
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [searchOpen, onSearchOpenChange]);

  // "/" jumps to search on desktop, like most web apps.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const input = desktopSearchRef.current;
      if (!input || input.offsetParent === null) return;
      e.preventDefault();
      focusDesktopSearch(input, fieldHiddenRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [desktopSearchRef]);

  const zoom = useZoom();
  const nextZoom = ZOOM_LEVELS[(ZOOM_LEVELS.indexOf(zoom) + 1) % ZOOM_LEVELS.length];
  const zoomButton =
    canSelect && !selectMode ? (
      <button
        type="button"
        onClick={() => setZoom(nextZoom)}
        aria-label={`${ZOOM_LABELS[zoom]} view. Switch to ${ZOOM_LABELS[nextZoom].toLowerCase()} view`}
        title="Change view (pinch, or Ctrl + scroll)"
        className={`${iconButtonClass({ variant: "tile", size: 40 })} sm:w-auto sm:gap-2 sm:px-3`}
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
        aria-label="Select"
        title="Select"
        className={`${iconButtonClass({ variant: "tile", size: 40 })} sm:w-auto sm:gap-2 sm:px-3`}
      >
        <SelectIcon size={18} />
        <span className="hidden text-small font-medium sm:inline">Select</span>
      </button>
    ) : null;


  return (
    <div
      className={`relative border-b pt-safe transition-[background-color,border-color] duration-200 ease-out-expo sm:pt-0 ${
        collapsed ? "glass-bg border-border/60" : "border-transparent bg-bg"
      }`}
    >
      {searchOpen && (
        // The panel of suggestions hangs under the whole bar (the filter chips stay in view).
        <div className="flex h-14 animate-fade-in items-center gap-1.5 pl-1.5 pr-4 sm:hidden">
          <IconButton variant="ghost" label="Close search" onClick={closeSearch}>
            <BackIcon size={20} />
          </IconButton>
          <SmartSearchField
            variant="phone"
            autoFocus
            query={query}
            onQueryChange={onQueryChange}
            suggest={suggest}
            repoKey={repoKey}
            entriesById={entriesById}
            onFocus={onSearchFocus}
            className="min-w-0 flex-1"
          />
          {selectButton && <div className="pl-1">{selectButton}</div>}
        </div>
      )}

      <div className={`mx-auto h-14 w-full max-w-6xl items-center gap-2 px-4 sm:flex sm:px-6 ${searchOpen ? "hidden" : "flex"}`}>
        {/* The large title (display h1) and the compact one share the spot and cross-fade. */}
        <div className="relative shrink-0">
          <h1
            className={`origin-left whitespace-nowrap font-display text-h1 text-ink transition-[opacity,transform] duration-250 ease-out-expo ${
              collapsed ? "absolute left-0 top-1/2 -translate-y-1/2 scale-[0.96] opacity-0" : ""
            }`}
          >
            Photos
          </h1>
          <p
            aria-hidden="true"
            className={`whitespace-nowrap text-h3 text-ink transition-[opacity,transform] duration-250 ease-out-expo ${
              collapsed ? "" : "pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 opacity-0"
            }`}
          >
            Photos
          </p>
        </div>
        {/* The status badge. Phones have no room for it next to the large title, so there it sits
         * on the telemetry line (GalleryIntro) and moves up here once the bar is compact. */}
        <div
          className={`flex min-w-0 flex-1 justify-end transition-[opacity,visibility] duration-250 ease-out-expo ${
            collapsed ? "" : "max-sm:invisible max-sm:opacity-0"
          }`}
        >
          <HeaderBadge offline={offline} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fieldHidden && (
            <>
              <IconButton label="Search" onClick={() => onSearchOpenChange(true)} className="animate-fade-in sm:hidden">
                <SearchIcon size={18} />
              </IconButton>
              <IconButton
                label="Search"
                onClick={() => focusDesktopSearch(desktopSearchRef.current, true)}
                className="hidden animate-fade-in sm:inline-flex"
              >
                <SearchIcon size={18} />
              </IconButton>
            </>
          )}
          {zoomButton}
          {selectButton}
        </div>
      </div>

      {searchOpen && (
        // Pinned in search mode: the chips and what they add up to (118 MATCHES · 431 MB), so
        // the suggestions hang below both.
        <div className="px-4 pb-2 sm:hidden">
          <FilterChips {...props} />
          {props.telemetry && <Telemetry items={props.telemetry} className="pt-1.5" />}
        </div>
      )}
    </div>
  );
}

/**
 * The part of the Photos header that scrolls away: the telemetry line, the search field (on
 * phones a field-shaped button that opens the search mode) and the filter chips.
 */
export function GalleryIntro(props: GalleryHeaderProps) {
  const { query, onQueryChange, searchOpen, onSearchOpenChange, repoKey, entriesById, suggest, onSearchFocus } = props;
  const { telemetry, backingUp, offline, collapsed, headerHeight, fieldHidden, onFieldHiddenChange, desktopSearchRef } = props;
  const fieldRef = useRef<HTMLDivElement>(null);

  // Hidden = scrolled up under the sticky bar (not merely below the fold).
  useEffect(() => {
    const el = fieldRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const top = entry.rootBounds?.top ?? 0;
        onFieldHiddenChange(!entry.isIntersecting && entry.boundingClientRect.bottom <= top + 1);
      },
      { root: scrollParent(el), rootMargin: `-${Math.round(headerHeight)}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      onFieldHiddenChange(false);
    };
  }, [headerHeight, onFieldHiddenChange, searchOpen]);

  return (
    <div className={`relative z-20 mx-auto w-full max-w-6xl px-4 sm:px-6 sm:pb-2 ${searchOpen ? "" : "pb-2"}`}>
      <div className={`h-6 items-center gap-3 sm:h-[14px] ${searchOpen ? "hidden sm:flex" : "flex"}`}>
        {telemetry ? (
          <>
            <Telemetry items={telemetry} className="flex-1 sm:hidden" />
            <Telemetry items={backingUp ? [...telemetry, "Backing up"] : telemetry} className="hidden flex-1 sm:block" />
          </>
        ) : (
          <span className="skeleton block h-2.5 w-40 rounded-[3px]" />
        )}
        {/* Phones: the badge at the end of the line; it hands over to the compact bar's copy as
         * the header collapses. */}
        <div
          className={`ml-auto flex min-w-0 max-w-[62%] shrink-0 justify-end transition-[opacity,visibility] duration-250 ease-out-expo sm:hidden ${
            collapsed ? "invisible opacity-0" : ""
          }`}
        >
          <HeaderBadge offline={offline} />
        </div>
      </div>
      <div className={`flex flex-col gap-1.5 pt-3 sm:flex-row sm:pt-4 sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2 ${searchOpen ? "hidden sm:flex" : ""}`}>
        <div ref={fieldRef} className="min-w-0 sm:w-[24rem] lg:w-[28rem]">
          {/* Phones: tapping the field opens the search mode. Under the bar it leaves the
           * accessibility tree to the bar's search button. */}
          <button
            type="button"
            onClick={() => onSearchOpenChange(true)}
            aria-label="Search"
            aria-hidden={fieldHidden || undefined}
            tabIndex={fieldHidden ? -1 : undefined}
            className={`${SEARCH_FIELD_CLASS} w-full gap-3 px-3.5 text-left text-body-lg outline-none active:bg-surface-3 sm:hidden`}
          >
            <SearchIcon size={18} className="shrink-0 text-ink-muted" />
            <span className={`min-w-0 truncate ${query ? "text-ink" : "text-ink-muted"}`}>{query || SEARCH_PLACEHOLDER}</span>
          </button>
          <SmartSearchField
            ref={desktopSearchRef}
            variant="desktop"
            query={query}
            onQueryChange={onQueryChange}
            suggest={suggest}
            repoKey={repoKey}
            entriesById={entriesById}
            onFocus={onSearchFocus}
            className="hidden sm:block"
          />
        </div>
        {/* In the phone search mode the chips are pinned in the bar instead. */}
        {!searchOpen && <FilterChips {...props} />}
      </div>
    </div>
  );
}
