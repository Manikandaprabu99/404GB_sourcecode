"use client";

import Link from "next/link";
import { personHref, useFaceScanStatus, usePeople } from "@/lib/faces/people";
import FaceAvatar from "./FaceAvatar";
import { scanFraction, scanHeadline, scanInProgress } from "./scanText";
import { FaceIcon } from "./icons";

/** How many faces the row shows before "More". */
const ROW_MAX = 12;

const headingClass = "text-body-lg font-semibold tracking-tight text-ink";

/** The "People" row on the Albums screen: face avatars that open a person's photos. */
export default function PeopleRow({ repoKey }: { repoKey: string }) {
  const { people, ready } = usePeople(repoKey);
  const status = useFaceScanStatus();
  if (!ready) return null;

  if (people.length === 0) {
    // Nobody yet: say that faces are being looked for, or stay out of the way.
    if (!scanInProgress(status) || status.repoKey !== repoKey) return null;
    return (
      <section aria-label="People" className="flex flex-col gap-3">
        <h2 className={headingClass}>People</h2>
        <div className="flex animate-fade-in items-center gap-3.5 rounded-2xl border border-border bg-surface px-4 py-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <FaceIcon size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink">{scanHeadline(status)}</p>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-320 ease-out-expo"
                style={{ width: `${Math.max(2, scanFraction(status) * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const shown = people.slice(0, ROW_MAX);
  const more = people.length - shown.length;
  return (
    <section aria-label="People" className="flex flex-col gap-3">
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h2 className={headingClass}>People</h2>
        <Link
          href="/people"
          className="rounded-full px-3 py-1.5 text-small font-medium text-accent transition-colors duration-180 hover:bg-accent/10"
        >
          See all
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {shown.map((person) => (
          <li key={person.id} className="w-[4.5rem] shrink-0 animate-fade-in snap-start">
            <Link
              href={personHref(person.id)}
              aria-label={person.name ?? `Unnamed person, ${person.mediaIds.length} photos`}
              className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <FaceAvatar
                repoKey={repoKey}
                face={person.cover}
                className="h-[4.5rem] w-[4.5rem] transition-transform duration-250 ease-out-expo group-hover:-translate-y-0.5 group-active:scale-[0.95]"
              />
              <span className={`mt-1.5 block truncate text-center text-small ${person.name ? "text-ink" : "text-ink-faint"}`}>
                {person.name ?? " "}
              </span>
            </Link>
          </li>
        ))}
        {more > 0 && (
          <li className="w-[4.5rem] shrink-0 animate-fade-in snap-start">
            <Link
              href="/people"
              aria-label={`See all ${people.length} people`}
              className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border border-border bg-surface-2 text-body font-semibold text-ink-muted transition-colors duration-180 group-hover:bg-surface-3">
                …
              </span>
              <span className="mt-1.5 block truncate text-center text-small text-ink-muted">+{more.toLocaleString()}</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
