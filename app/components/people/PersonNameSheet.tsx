"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { PersonDetails } from "@/lib/faces/people";
import Sheet from "@/app/components/ui/Sheet";
import { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import SectionLabel from "@/app/components/ui/SectionLabel";
import FaceAvatar from "./FaceAvatar";

const NAME_MAX = 60;

interface PersonNameSheetProps {
  open: boolean;
  repoKey: string;
  person: PersonDetails;
  /** Other named people: typing one of their names offers "same person" instead of a duplicate. */
  others: readonly PersonDetails[];
  onRename: (name: string | null) => void;
  onSamePerson: (other: PersonDetails) => void;
  onClose: () => void;
}

/** Name (or rename) a person; picking an existing name merges them into that person. */
export default function PersonNameSheet({
  open,
  repoKey,
  person,
  others,
  onRename,
  onSamePerson,
  onClose,
}: PersonNameSheetProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(person.name ?? "");

  useEffect(() => {
    if (!open) return;
    setName(person.name ?? "");
    const frame = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(frame);
  }, [open, person.name]);

  const query = name.trim().toLocaleLowerCase();
  const matches = useMemo(() => {
    if (!query) return [];
    return others
      .filter((other) => other.name && other.id !== person.id && other.name.toLocaleLowerCase().startsWith(query))
      .slice(0, 4);
  }, [others, person.id, query]);
  const exact = matches.find((other) => other.name!.toLocaleLowerCase() === query);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (exact) {
      onSamePerson(exact);
      return;
    }
    const trimmed = name.trim();
    if (trimmed === (person.name ?? "")) {
      onClose();
      return;
    }
    onRename(trimmed || null);
  }

  return (
    <Sheet open={open} onClose={onClose} title={person.name ? "Rename" : "Add a name"}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <FaceAvatar repoKey={repoKey} face={person.cover} className="h-12 w-12 ring-1 ring-border/60" />
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX}
            placeholder="Who is this?"
            aria-label="Name"
            enterKeyHint="done"
            autoComplete="off"
            className="h-12 min-w-0 flex-1 rounded-control bg-surface-2 px-4 text-body text-ink placeholder:text-ink-faint"
          />
        </div>
        {matches.length > 0 && (
          <div className="flex flex-col gap-1">
            <SectionLabel as="p" className="px-1 pb-1">
              Same person?
            </SectionLabel>
            {matches.map((other) => (
              <button
                key={other.id}
                type="button"
                onClick={() => onSamePerson(other)}
                className="flex min-h-[56px] items-center gap-3 rounded-control px-2 py-2 text-left transition-colors duration-180 hover:bg-surface-2"
              >
                <FaceAvatar repoKey={repoKey} face={other.cover} className="h-10 w-10" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{other.name}</span>
                  <span className="mt-0.5 block text-footnote tabular-nums text-ink-muted">
                    Merge · {other.mediaIds.length.toLocaleString()} {other.mediaIds.length === 1 ? "photo" : "photos"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {person.name && (
            <button type="button" onClick={() => onRename(null)} className={`${secondaryButtonClass} mr-auto`}>
              Remove name
            </button>
          )}
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() && !person.name} className={primaryButtonClass}>
            {exact ? "Merge" : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
