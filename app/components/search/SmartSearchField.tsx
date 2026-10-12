"use client";

import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { applySuggestion, type Suggestion, type SuggestionKind, type Suggestions } from "@/lib/library/search";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import { AlbumsIcon, CalendarIcon, CloseIcon, FolderIcon, HeartIcon, PlayIcon, SearchIcon } from "@/app/components/library/icons";
import FaceAvatar from "./FaceAvatar";

interface SmartSearchFieldProps {
  /** "phone": the full-width title-row field; "desktop": the pill in the header. */
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
}

export const SEARCH_PLACEHOLDER = "Search people, apps, dates…";

function kindIcon(kind: SuggestionKind, label: string): ReactNode {
  if (kind === "date") return <CalendarIcon size={15} />;
  if (kind === "album") return <AlbumsIcon size={15} />;
  if (kind === "category") return <FolderIcon size={15} />;
  if (label === "Favorites") return <HeartIcon size={14} />;
  if (label === "Videos") return <PlayIcon size={12} />;
  return <SearchIcon size={14} />;
}

/**
 * The gallery's search box with suggestions: a combobox whose listbox shows people (faces),
 * categories, dates, albums and kinds of items while it has focus. Arrow keys move through
 * them, Enter picks one (or closes the list), Escape closes the list. Picking puts the
 * suggestion's words in place of what's being typed, ready for the next word, and shows the results.
 */
const SmartSearchField = forwardRef<HTMLInputElement, SmartSearchFieldProps>(function SmartSearchField(
  { variant, query, onQueryChange, suggest, repoKey, entriesById, autoFocus, onFocus },
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
      className={`absolute z-40 flex animate-fade-in flex-col gap-3.5 overflow-y-auto overscroll-contain border border-border bg-surface p-3 shadow-elevated ${
        phone
          ? "inset-x-0 top-full max-h-[calc(100dvh-11rem)] rounded-b-2xl border-x-0 border-t-0"
          : "right-0 top-full mt-2 max-h-[min(32rem,70vh)] w-[min(28rem,calc(100vw-3rem))] rounded-2xl"
      }`}
    >
      {suggestions.groups.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className="flex flex-col gap-2">
          <p role="presentation" className="px-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">
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
                    className={`flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 transition-colors duration-180 ${
                      selected ? "bg-surface-3" : "hover:bg-surface-2"
                    }`}
                  >
                    <FaceAvatar
                      repoKey={repoKey}
                      cover={s.person?.cover}
                      entry={s.person?.cover ? entriesById.get(s.person.cover.mediaId) : undefined}
                    />
                    <span className="w-full truncate text-center text-micro font-medium text-ink">{s.label}</span>
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
                    className={`inline-flex h-9 max-w-full items-center gap-2 rounded-full border pl-1 pr-3 text-small font-medium transition-[background-color,border-color,transform] duration-180 ease-out-expo active:scale-95 ${
                      selected ? "border-accent bg-accent/10 text-ink" : "border-border bg-surface-2 text-ink hover:border-border-strong"
                    }`}
                  >
                    {thumb ? (
                      <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-full bg-surface-3">
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
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
                        {kindIcon(s.kind, s.label)}
                      </span>
                    )}
                    <span className="truncate">{s.label}</span>
                    {s.count !== undefined && (
                      <span className="shrink-0 text-micro tabular-nums text-ink-faint">{s.count.toLocaleString()}</span>
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

  const input = (
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
      className={
        phone
          ? "h-10 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          : "h-9 w-full rounded-full border border-border bg-surface pl-9 pr-9 text-small text-ink outline-none transition-colors duration-180 placeholder:text-ink-faint focus:border-accent [&::-webkit-search-cancel-button]:hidden"
      }
    />
  );

  if (phone) {
    return (
      <>
        {input}
        {query && (
          <button
            type="button"
            onClick={() => {
              onQueryChange("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          >
            <CloseIcon size={16} />
          </button>
        )}
        {panel}
      </>
    );
  }

  return (
    <div className="relative hidden w-56 sm:block lg:w-80">
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
      {input}
      {query && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onQueryChange("")}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon size={14} />
        </button>
      )}
      {panel}
    </div>
  );
});

export default SmartSearchField;
