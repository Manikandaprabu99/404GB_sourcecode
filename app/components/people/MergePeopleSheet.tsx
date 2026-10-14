"use client";

import { useEffect, useMemo, useState } from "react";
import { personDistance, type PersonDetails } from "@/lib/faces/people";
import Sheet from "@/app/components/ui/Sheet";
import { primaryButtonClass, secondaryButtonClass } from "@/app/components/library/EmptyState";
import SelectCheck from "@/app/components/ui/SelectCheck";
import FaceAvatar from "./FaceAvatar";

const PAGE = 40;

interface MergePeopleSheetProps {
  open: boolean;
  repoKey: string;
  person: PersonDetails;
  people: readonly PersonDetails[];
  onMerge: (others: PersonDetails[]) => void;
  onClose: () => void;
}

function photos(count: number): string {
  return count === 1 ? "1 photo" : `${count.toLocaleString()} photos`;
}

/** Face picker: who else is this person? The most alike faces come first. */
export default function MergePeopleSheet({ open, repoKey, person, people, onMerge, onClose }: MergePeopleSheetProps) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setLimit(PAGE);
  }, [open, person.id]);

  const candidates = useMemo(() => {
    if (!open) return [];
    return people
      .filter((other) => other.id !== person.id)
      .map((other) => ({ other, distance: personDistance(person.id, other.id) }))
      .sort((a, b) => a.distance - b.distance || b.other.mediaIds.length - a.other.mediaIds.length)
      .map(({ other }) => other);
  }, [open, people, person.id]);

  const shown = candidates.slice(0, limit);
  const chosen = candidates.filter((other) => selected.has(other.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Sheet open={open} onClose={onClose} title={person.name ? `Merge with ${person.name}` : "Same person as…"}>
      <div className="flex flex-col gap-4">
        <p className="text-callout font-normal text-ink-muted">
          Pick everyone who is really {person.name ?? "this person"}. Their photos are grouped together, on all your
          devices.
        </p>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-muted">No other people found yet.</p>
        ) : (
          <ul className="grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-5">
            {shown.map((other) => {
              const on = selected.has(other.id);
              return (
                <li key={other.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(other.id)}
                    className="group flex w-full flex-col items-center rounded-control p-1 focus-visible:outline-none"
                  >
                    <span className="relative">
                      {/* Picked: the People colour around the face and the square check. */}
                      <FaceAvatar
                        repoKey={repoKey}
                        face={other.cover}
                        muted={other.hidden}
                        className={`h-16 w-16 ring-offset-2 ring-offset-surface transition-[transform,box-shadow] duration-180 ease-out-expo group-focus-visible:ring-2 group-focus-visible:ring-accent group-active:scale-95 ${
                          on ? "!ring-[3px] !ring-accent-2" : ""
                        }`}
                      />
                      {on && (
                        <span className="absolute -right-1 -top-1">
                          <SelectCheck selected variant="surface" />
                        </span>
                      )}
                    </span>
                    <span className={`mt-1.5 w-full truncate text-center text-footnote font-medium ${other.name ? "text-ink" : "text-ink-muted"}`}>
                      {other.name ?? photos(other.mediaIds.length)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {candidates.length > limit && (
          <button type="button" onClick={() => setLimit((n) => n + PAGE)} className={`${secondaryButtonClass} self-center`}>
            Show more
          </button>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" disabled={chosen.length === 0} onClick={() => onMerge(chosen)} className={primaryButtonClass}>
            {chosen.length > 1 ? `Merge ${chosen.length}` : "Merge"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
