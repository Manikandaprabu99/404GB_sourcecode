"use client";

import { useEffect, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import type { MediaIndexEntry } from "@/lib/media";
import type { Person, ScanStatus } from "@/lib/faces/people";
import { removeTerm, type SearchTerm, type Suggestions } from "@/lib/library/search";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { setZoom, useZoom, ZOOM_LABELS, ZOOM_LEVELS } from "@/lib/library/zoom";
import BackupStatusPill, { StatusPill } from "@/app/components/backup/BackupStatusPill";
import SmartSearchField from "@/app/components/search/SmartSearchField";
import FaceAvatar from "@/app/components/search/FaceAvatar";
import { TermChip } from "@/app/components/ui/Chip";
import IconButton from "@/app/components/ui/IconButton";
import {
  AlbumsIcon,
  BackIcon,
  CalendarIcon,
  ClockIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  PersonIcon,
  PhotosIcon,
  PlayIcon,
  SearchIcon,
  SelectIcon,
  ViewGridIcon,
} from "@/app/components/library/icons";

/** What the rail shows (lib/library/viewState's filters plus the rail's collections). */
export type GalleryFilter = "all" | "photos" | "videos" | "favorites" | "screenshots" | "selfies" | "recent";

/** What the collections rail knows about the library. */
export interface RailInfo {
  hasScreenshots: boolean;
  hasSelfies: boolean;
  people: Person[];
  scan: ScanStatus;
  entriesById: ReadonlyMap<string, MediaIndexEntry>;
}

export interface GalleryHeaderProps {
  filter: GalleryFilter;
  onFilterChange: (filter: GalleryFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Phone search mode (the title row turns into the search field). */
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
  /** The subtitle's facts (`1,443 items`, `17.8 GB`); null while the library loads. */
  subtitle: string[] | null;
  /** Scrolled a little: the large title gives way to the compact glass bar. */
  collapsed: boolean;
  /** The desktop search input (in the bar), for "/". */
  desktopSearchRef: RefObject<HTMLInputElement>;
  rail: RailInfo;
  /** Nothing in the library yet: no search, no count. */
  libraryEmpty: boolean;
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

/** The backup (or offline) status pill. */
function HeaderBadge({ offline }: { offline: boolean }) {
  return offline ? <StatusPill label="Offline" tone="muted" icon="off" /> : <BackupStatusPill />;
}

// Round 40px glass buttons (docs/DESIGN.md › PageHeader); 44px hit area.
const ROUND =
  "lp-round relative inline-flex h-10 min-w-10 shrink-0 select-none items-center justify-center gap-2 rounded-full text-ink outline-none transition-[background-color,transform,opacity] duration-160 ease-out after:absolute after:-inset-0.5 after:content-[''] active:scale-[0.94] focus-visible:ring-2 focus-visible:ring-accent";

function ScreenshotIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

/** A tiny progress ring (People scanning). */
export function MiniRing({ value, size = 14 }: { value: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.22} strokeWidth={2} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(var(--accent-text, var(--accent)))"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={`${Math.max(0.04, Math.min(1, value)) * c} ${c}`}
      />
    </svg>
  );
}

const RAIL_PILL =
  "lp-pill inline-flex h-9 shrink-0 select-none items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium leading-5 text-ink outline-none transition-[background-color,color,transform] duration-160 ease-out active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/** Quick collections rail: filter pills (a radio group), the People pill and the query's terms. */
export function QuickRail({ filter, onFilterChange, terms, query, onQueryChange, repoKey, rail }: GalleryHeaderProps) {
  const pills: { value: GalleryFilter; label: string; icon?: ReactNode }[] = [
    { value: "all", label: "All" },
    { value: "favorites", label: "Favorites", icon: <HeartIcon size={15} filled={filter === "favorites"} /> },
    { value: "videos", label: "Videos", icon: <PlayIcon size={12} /> },
  ];
  if (rail.hasScreenshots || filter === "screenshots") pills.push({ value: "screenshots", label: "Screenshots", icon: <ScreenshotIcon /> });
  if (rail.hasSelfies || filter === "selfies") pills.push({ value: "selfies", label: "Selfies", icon: <PersonIcon size={15} /> });
  pills.push({ value: "recent", label: "Recently added", icon: <ClockIcon size={15} /> });
  if (filter === "photos") pills.splice(1, 0, { value: "photos", label: "Photos", icon: <PhotosIcon size={15} /> });

  const scanning = rail.scan.state === "scanning" && rail.scan.total > 0;
  const faces = rail.people.slice(0, 3);
  return (
    <div className="-mx-4 flex h-12 items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
      <div role="radiogroup" aria-label="Show" className="flex shrink-0 items-center gap-2">
        {pills.map(({ value, label, icon }) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onFilterChange(active && value !== "all" ? "all" : value)}
              className={RAIL_PILL}
            >
              {icon && <span className={`flex items-center ${active ? "" : "text-ink-muted"}`}>{icon}</span>}
              {label}
            </button>
          );
        })}
      </div>
      <Link href="/people" aria-label={scanning ? `People, finding people ${Math.round((rail.scan.done / rail.scan.total) * 100)}%` : "People"} className={`${RAIL_PILL} ${faces.length ? "pl-1.5" : ""}`}>
        {faces.length > 0 ? (
          <span aria-hidden="true" className="flex items-center">
            {faces.map((person, i) => (
              <span key={person.id} className={`block rounded-full border-2 border-surface-2 ${i > 0 ? "-ml-2" : ""}`} style={{ zIndex: 3 - i }}>
                <FaceAvatar
                  repoKey={repoKey}
                  cover={person.cover}
                  entry={person.cover ? rail.entriesById.get(person.cover.mediaId) : undefined}
                  className="h-6 w-6"
                />
              </span>
            ))}
          </span>
        ) : (
          <span className="text-ink-muted">
            <PersonIcon size={15} />
          </span>
        )}
        People
        {scanning && <MiniRing value={rail.scan.done / rail.scan.total} />}
      </Link>
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

/** Sticky bar: large "Photos" title and round buttons; collapses into the compact glass bar.
 * On phones, search turns it into a full-width field with the rail pinned under it. */
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
    desktopSearchRef,
  } = props;

  const closeSearch = () => {
    onSearchOpenChange(false);
    onQueryChange("");
  };
  useHistoryOverlay(searchOpen, closeSearch);

  // The search mode is a phone layout: a window widening past it leaves it (keeping the query).
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
      input.focus();
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
        className={`${ROUND} w-10 sm:w-auto sm:px-3.5`}
      >
        <ViewGridIcon size={18} density={zoom === "day" ? 2 : zoom === "month" ? 3 : 4} />
        <span key={zoom} className="hidden animate-fade-in text-[14px] font-medium sm:inline">
          {ZOOM_LABELS[zoom]}
        </span>
      </button>
    ) : null;

  const selectButton =
    canSelect && !selectMode ? (
      <button type="button" onClick={onSelect} aria-label="Select" title="Select" className={`${ROUND} w-10 sm:w-auto sm:px-3.5`}>
        <SelectIcon size={18} />
        <span className="hidden text-[14px] font-medium sm:inline">Select</span>
      </button>
    ) : null;

  return (
    <div
      className={`relative pt-safe transition-[background-color,box-shadow] duration-240 ease-out sm:pt-0 ${
        collapsed || searchOpen ? "lp-glass shadow-[0_1px_0_rgb(var(--ink)/0.07)]" : ""
      }`}
    >
      {searchOpen && (
        // The suggestions hang under the whole bar (the rail stays in view).
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

      <div className={`relative mx-auto h-14 w-full max-w-6xl items-center gap-2 px-4 sm:flex sm:px-6 ${searchOpen ? "hidden" : "flex"}`}>
        {/* The large title and the compact one share the bar and cross-fade. */}
        <div className="relative min-w-0 flex-1 sm:flex-none">
          <h1
            className={`origin-left whitespace-nowrap text-[32px] font-bold leading-[38px] tracking-[-0.025em] text-ink transition-[opacity,transform] duration-240 ease-out lg:text-[34px] lg:leading-10 ${
              collapsed ? "pointer-events-none translate-y-[-2px] scale-[0.92] opacity-0" : ""
            }`}
          >
            Photos
          </h1>
          <div
            className={`absolute inset-y-0 left-0 flex max-w-full items-center transition-opacity duration-240 ease-out max-sm:max-w-[38%] ${
              collapsed ? "" : "pointer-events-none opacity-0"
            }`}
          >
            <div className="hidden max-sm:block">{collapsed && <HeaderBadge offline={offline} />}</div>
            <p aria-hidden="true" className="hidden whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] text-ink sm:block">
              Photos
            </p>
          </div>
        </div>
        {/* Phones: the compact title is centred in the bar. */}
        <p
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] text-ink transition-opacity duration-240 ease-out sm:hidden ${
            collapsed ? "opacity-100" : "opacity-0"
          }`}
        >
          Photos
        </p>
        <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 sm:flex">
          <div className={`min-w-0 transition-opacity duration-240 ${collapsed ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            {collapsed && <HeaderBadge offline={offline} />}
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
            className="w-[min(22rem,40vw)] lg:w-[26rem]"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {zoomButton}
          {!props.libraryEmpty && (
            <button type="button" onClick={() => onSearchOpenChange(true)} aria-label="Search" className={`${ROUND} w-10 sm:hidden`}>
              <SearchIcon size={18} />
            </button>
          )}
          {selectButton}
        </div>
      </div>

      {searchOpen && (
        // Pinned in search mode: the rail and what it adds up to (118 matches · 431 MB).
        <div className="px-4 pb-1.5 sm:hidden">
          <QuickRail {...props} />
          {props.subtitle && <Subtitle facts={props.subtitle} />}
        </div>
      )}
    </div>
  );
}

function Subtitle({ facts }: { facts: string[] }) {
  return <p className="truncate text-[13px] leading-[18px] text-ink-muted tabular-nums">{facts.join(" · ")}</p>;
}

/** The part of the header that scrolls away: subtitle and backup pill over the aurora. */
export function GalleryIntro({ subtitle, offline, searchOpen, collapsed, libraryEmpty }: GalleryHeaderProps) {
  return (
    <div className={`relative mx-auto w-full max-w-6xl px-4 sm:px-6 ${searchOpen ? "hidden" : ""}`}>
      {/* Under the transparent bar too: it starts above this block. */}
      <div aria-hidden="true" className="lp-aurora pointer-events-none absolute inset-x-[-50vw] -top-[calc(56px+var(--safe-area-inset-top,env(safe-area-inset-top,0px)))] h-[420px] sm:-top-14" />
      <div className="relative flex h-8 items-center gap-2.5 pb-1">
        {libraryEmpty && subtitle ? null : subtitle ? <Subtitle facts={subtitle} /> : <span className="skeleton block h-3 w-40 rounded-full" />}
        <div className={`flex min-w-0 shrink-0 transition-opacity duration-240 ${collapsed ? "pointer-events-none opacity-0" : ""}`}>
          <HeaderBadge offline={offline} />
        </div>
      </div>
    </div>
  );
}
