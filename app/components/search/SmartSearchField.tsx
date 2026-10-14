"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { applySuggestion, type Suggestion, type SuggestionKind, type Suggestions } from "@/lib/library/search";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import { AlbumsIcon, CalendarIcon, ClockIcon, CloseIcon, FolderIcon, HeartIcon, PlayIcon, SearchIcon } from "@/app/components/library/icons";
import FaceAvatar from "./FaceAvatar";

interface SmartSearchFieldProps {
  /** "phone": the field in the search bar that replaces the title row; "desktop": the field
   * under the Photos title. */
  variant: "phone" | "desktop";
  query: string;
  onQueryChange: (query: string) => void;
  /** Suggestions for a query (people, categories, dates, albums, kinds of items). */
  suggest: (query: string) => Suggestions;
  repoKey: string;
  entriesById: ReadonlyMap<string, MediaIndexEntry>;
  autoFocus?: boolean;
  /** Called when the field gets focus (e.g. to load album names). */
  onFocus?: () => void;
  className?: string;
}

export const SEARCH_PLACEHOLDER = "Search people, dates, screenshots…";

/** The search field's shell (docs/DESIGN.md "Photos — new experiences" 9): a 44px glass pill
 * (surface-2 at 80% with a hairline) with an accent ring while focused. */
export const SEARCH_FIELD_CLASS =
  "relative flex h-11 min-w-0 items-center rounded-full bg-surface-2/80 text-ink shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.06)] transition-[background-color,box-shadow] duration-160 focus-within:bg-surface-2 focus-within:shadow-[0_0_0_2px_rgb(var(--accent))]";

// Recent searches (this device only; a convenience, so storage failures are ignored).
const RECENT_KEY = "404gb-recent-searches";
const RECENT_MAX = 6;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((q): q is string => typeof q === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function rememberSearch(query: string): string[] {
  const q = query.trim();
  const list = readRecent();
  if (!q) return list;
  const next = [q, ...list.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: recent searches last for this visit only.
  }
  return next;
}

function kindIcon(kind: SuggestionKind, label: string): ReactNode {
  if (kind === "date") return <CalendarIcon size={16} />;
  if (kind === "album") return <AlbumsIcon size={16} />;
  if (kind === "category") return <FolderIcon size={16} />;
  if (label === "Favorites") return <HeartIcon size={15} />;
  if (label === "Videos") return <PlayIcon size={13} />;
  return <SearchIcon size={15} />;
}

// Suggestion options: 40px pills with a 32px visual inset by 4px; people are round avatars with
// their names under them.
const OPTION =
  "inline-flex h-10 max-w-full shrink-0 items-center gap-2.5 pl-1 pr-3.5 text-[14px] font-medium text-ink transition-[background-color,box-shadow,transform] duration-160 ease-out active:scale-[0.97]";
const OPTION_ON = "bg-surface-3 shadow-[inset_0_0_0_1.5px_rgb(var(--accent))]";
const OPTION_OFF = "bg-surface-2 hover:bg-surface-3";
const GROUP_TITLE = "px-1 text-[13px] font-semibold leading-[18px] text-ink-muted";

/**
 * The gallery's search box with suggestions: a combobox whose listbox shows people (faces),
 * categories, dates, albums and kinds of items while it has focus. Arrow keys move through
 * them, Enter picks one (or closes the list), Escape closes the list. Picking puts the
 * suggestion's words in place of what's being typed, ready for the next word, and shows the results.
 */
const SmartSearchField = forwardRef<HTMLInputElement, SmartSearchFieldProps>(function SmartSearchField(
  { variant, query, onQueryChange, suggest, repoKey, entriesById, autoFocus, onFocus, className },
  forwardedRef
) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);

  const suggestions = useMemo(() => (open ? suggest(query) : null), [open, suggest, query]);
  // Recent searches lead the list while nothing is typed yet.
  const recentItems = useMemo<Suggestion[]>(
    () =>
      open && !query.trim()
        ? recent.map((q): Suggestion => ({ key: `recent:${q}`, kind: "type", label: q, insert: q }))
        : [],
    [open, query, recent]
  );
  const flat = useMemo(() => [...recentItems, ...(suggestions?.groups.flatMap((g) => g.items) ?? [])], [recentItems, suggestions]);
  const active = activeKey ? flat.find((s) => s.key === activeKey) : undefined;
  const showPanel = open && flat.length > 0;
  const optionId = (key: string) => `${listId}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const phone = variant === "phone";

  // A pick shows its results: the list closes (typing, arrows or a tap bring it back for the
  // next term) and on phones the keyboard goes away too.
  const pick = (suggestion: Suggestion) => {
    if (!suggestions) return;
    const isRecent = suggestion.key.startsWith("recent:");
    const next = isRecent ? `${suggestion.label} ` : applySuggestion(query, suggestions.replaceFrom, suggestion);
    onQueryChange(next);
    setRecent(rememberSearch(next));
    setActiveKey(null);
    setOpen(false);
    if (phone) inputRef.current?.blur();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) setOpen(true);
      if (flat.length === 0) return;
      e.preventDefault();
      const at = active ? flat.indexOf(active) : -1;
      const next = e.key === "ArrowDown" ? (at + 1) % flat.length : at <= 0 ? flat.length - 1 : at - 1;
      setActiveKey(flat[next].key);
      document.getElementById(optionId(flat[next].key))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    } else if (e.key === "Enter") {
      if (showPanel && active) {
        e.preventDefault();
        pick(active);
        return;
      }
      setOpen(false);
      setActiveKey(null);
      if (query.trim()) setRecent(rememberSearch(query));
      // Phones: Search on the keyboard puts it away so the results show.
      if (phone) inputRef.current?.blur();
    } else if (e.key === "Escape" && showPanel) {
      // Only closes the list; a second Escape is the screen's (closing search).
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setActiveKey(null);
    }
  };

  const chip = (s: Suggestion, visual: ReactNode) => {
    const selected = s.key === activeKey;
    return (
      <button
        key={s.key}
        id={optionId(s.key)}
        type="button"
        role="option"
        aria-selected={selected}
        tabIndex={-1}
        onClick={() => pick(s)}
        onMouseEnter={() => setActiveKey(s.key)}
        className={`${OPTION} rounded-full ${selected ? OPTION_ON : OPTION_OFF}`}
      >
        {visual}
        <span className="truncate">{s.label}</span>
        {s.count !== undefined && <span className="shrink-0 text-[12px] tabular-nums text-ink-muted">{s.count.toLocaleString()}</span>}
      </button>
    );
  };
  const iconBadge = (icon: ReactNode) => (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">{icon}</span>
  );

  const panel = showPanel && suggestions && (
    <div
      id={listId}
      role="listbox"
      aria-label="Search suggestions"
      // Clicks on options must not take focus from the field (that would close the list first).
      onMouseDown={(e) => e.preventDefault()}
      // Solid, not glass: a backdrop-filter inside the glass bar can't blur the page behind it.
      className={`absolute z-40 flex animate-fade-in flex-col gap-4 overflow-y-auto overscroll-contain rounded-[22px] bg-surface p-3.5 shadow-[inset_0_0_0_1px_rgb(var(--ink)/0.07),0_18px_48px_-12px_rgb(0_0_0/0.45)] ${
        phone
          ? "inset-x-2 top-full mt-1 max-h-[calc(100dvh-13.5rem)]"
          : "right-0 top-full mt-2 max-h-[min(32rem,70vh)] w-[min(32rem,calc(100vw-3rem))]"
      }`}
    >
      {recentItems.length > 0 && (
        <div role="group" aria-label="Recent" className="flex flex-col gap-2">
          <p role="presentation" className={GROUP_TITLE}>
            Recent
          </p>
          <div className="flex flex-wrap gap-1.5">{recentItems.map((s) => chip(s, iconBadge(<ClockIcon size={15} />)))}</div>
        </div>
      )}
      {suggestions.groups.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className="flex flex-col gap-2">
          <p role="presentation" className={GROUP_TITLE}>
            {group.title}
          </p>
          {group.title === "People" ? (
            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {group.items.map((s) => {
                const selected = s.key === activeKey;
                return (
                  <button
                    key={s.key}
                    id={optionId(s.key)}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    onClick={() => pick(s)}
                    onMouseEnter={() => setActiveKey(s.key)}
                    className="flex w-[68px] shrink-0 flex-col items-center gap-1.5 rounded-[16px] py-1 text-ink outline-none transition-transform duration-160 active:scale-[0.96]"
                  >
                    <span className={`block rounded-full p-[2px] transition-shadow duration-160 ${selected ? "shadow-[0_0_0_2px_rgb(var(--accent))]" : ""}`}>
                      <FaceAvatar
                        repoKey={repoKey}
                        cover={s.person?.cover}
                        entry={s.person?.cover ? entriesById.get(s.person.cover.mediaId) : undefined}
                        className="h-[52px] w-[52px]"
                      />
                    </span>
                    <span className="w-full truncate text-center text-[12px] font-medium leading-4">{s.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((s) => {
                const thumb = s.mediaId ? entriesById.get(s.mediaId) : undefined;
                return chip(
                  s,
                  thumb ? (
                    <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-surface-3">
                      <GalleryThumb
                        repoKey={repoKey}
                        mediaId={thumb.id}
                        alt=""
                        hasThumbnail={Boolean(thumb.thumb)}
                        isVideo={thumb.mimeType.startsWith("video/")}
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ) : (
                    iconBadge(kindIcon(s.kind, s.label))
                  )
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );

  // The panel hangs under the field on desktop; on phones the wrapper isn't positioned, so the
  // panel spans the search bar around it (the caller positions that).
  return (
    <div className={`${phone ? "" : "relative"} ${className ?? ""}`}>
      <div className={SEARCH_FIELD_CLASS}>
        <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="search"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-activedescendant={showPanel && active ? optionId(active.key) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
            setActiveKey(null);
          }}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onBlur={() => {
            setOpen(false);
            setActiveKey(null);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={SEARCH_PLACEHOLDER}
          aria-label="Search"
          // The ring is the field's (focus-within), not the input's own outline.
          className={`h-full w-full min-w-0 rounded-full bg-transparent pl-11 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden ${
            query ? "pr-11" : "pr-3.5"
          } ${phone ? "text-[16px]" : "text-[15px]"}`}
        />
        {query && (
          <button
            type="button"
            onMouseDown={phone ? undefined : (e) => e.preventDefault()}
            onClick={() => {
              onQueryChange("");
              if (phone) inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors duration-160 hover:bg-surface-3 hover:text-ink"
          >
            <CloseIcon size={16} />
          </button>
        )}
      </div>
      {panel}
    </div>
  );
});

export default SmartSearchField;
