"use client";

import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { applySuggestion, type Suggestion, type SuggestionKind, type Suggestions } from "@/lib/library/search";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import { AlbumsIcon, CalendarIcon, CloseIcon, FolderIcon, HeartIcon, PlayIcon, SearchIcon } from "@/app/components/library/icons";
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

/** The search field's shell (docs/DESIGN.md › Search field: 46px, radius 14, surface-2, a lime
 * ring while focused). Also used for the tap-to-search field on phones. */
export const SEARCH_FIELD_CLASS =
  "relative flex h-[46px] min-w-0 items-center rounded-control bg-surface-2 text-ink transition-[background-color,box-shadow] duration-180 focus-within:shadow-[0_0_0_2px_rgb(var(--accent))]";

function kindIcon(kind: SuggestionKind, label: string): ReactNode {
  if (kind === "date") return <CalendarIcon size={16} />;
  if (kind === "album") return <AlbumsIcon size={16} />;
  if (kind === "category") return <FolderIcon size={16} />;
  if (label === "Favorites") return <HeartIcon size={15} />;
  if (label === "Videos") return <PlayIcon size={13} />;
  return <SearchIcon size={15} />;
}

// Suggestion options: 40px rows of 14px radius with a 32px visual inset by 4px, so the corners
// stay concentric; people are pills with round avatars (faces are the one place circles stay).
const OPTION =
  "inline-flex h-10 max-w-full shrink-0 items-center gap-2.5 pl-1 pr-3 text-small font-medium text-ink transition-[background-color,box-shadow,transform] duration-180 ease-out-expo active:scale-[0.97]";
const OPTION_ON = "bg-surface-3 shadow-[inset_0_0_0_1.5px_rgb(var(--accent))]";
const OPTION_OFF = "bg-surface-2 hover:bg-surface-3";

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

  const suggestions = useMemo(() => (open ? suggest(query) : null), [open, suggest, query]);
  const flat = useMemo(() => suggestions?.groups.flatMap((g) => g.items) ?? [], [suggestions]);
  const active = activeKey ? flat.find((s) => s.key === activeKey) : undefined;
  const showPanel = open && flat.length > 0;
  const optionId = (key: string) => `${listId}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const phone = variant === "phone";

  // A pick shows its results: the list closes (typing, arrows or a tap bring it back for the
  // next term) and on phones the keyboard goes away too.
  const pick = (suggestion: Suggestion) => {
    if (!suggestions) return;
    onQueryChange(applySuggestion(query, suggestions.replaceFrom, suggestion));
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

  const panel = showPanel && suggestions && (
    <div
      id={listId}
      role="listbox"
      aria-label="Search suggestions"
      // Clicks on options must not take focus from the field (that would close the list first).
      onMouseDown={(e) => e.preventDefault()}
      className={`absolute z-40 flex animate-fade-in flex-col gap-4 overflow-y-auto overscroll-contain rounded-card border border-border/60 bg-surface p-3 shadow-elevated ${
        phone
          ? "inset-x-2 top-full mt-1 max-h-[calc(100dvh-13.5rem)]"
          : "left-0 top-full mt-2 max-h-[min(32rem,70vh)] w-[min(32rem,calc(100vw-3rem))]"
      }`}
    >
      {suggestions.groups.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className="flex flex-col gap-2">
          <p role="presentation" className="telemetry px-1 text-ink-muted">
            {group.title}
          </p>
          {group.title === "People" ? (
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                    className={`${OPTION} rounded-full ${selected ? OPTION_ON : OPTION_OFF}`}
                  >
                    <FaceAvatar
                      repoKey={repoKey}
                      cover={s.person?.cover}
                      entry={s.person?.cover ? entriesById.get(s.person.cover.mediaId) : undefined}
                      className="h-8 w-8"
                    />
                    <span className="truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {group.items.map((s) => {
                const selected = s.key === activeKey;
                const thumb = s.mediaId ? entriesById.get(s.mediaId) : undefined;
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
                    className={`${OPTION} rounded-control ${selected ? OPTION_ON : OPTION_OFF}`}
                  >
                    {thumb ? (
                      <span className="block h-8 w-8 shrink-0 overflow-hidden rounded-[10px] bg-surface-3">
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
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-3 text-ink-muted">
                        {kindIcon(s.kind, s.label)}
                      </span>
                    )}
                    <span className="truncate">{s.label}</span>
                    {s.count !== undefined && (
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{s.count.toLocaleString()}</span>
                    )}
                  </button>
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
          className={`h-full w-full min-w-0 rounded-control bg-transparent pl-11 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden ${
            query ? "pr-11" : "pr-3.5"
          } ${phone ? "text-body-lg" : "text-body"}`}
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
            className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-[11px] text-ink-muted transition-colors duration-180 hover:bg-surface-3 hover:text-ink"
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
