"use client";

import Link from "next/link";
import { personHref, useFaceScanStatus, usePeople } from "@/lib/faces/people";
import { buttonClass } from "@/app/components/ui/Button";
import { ProgressRing } from "@/app/components/ui/Progress";
import { cardClass } from "@/app/components/library/SettingsBlocks";
import FaceAvatar from "./FaceAvatar";
import { scanHeadline, scanInProgress } from "./scanText";
import { FaceIcon } from "./icons";

/** How many faces the row shows before "More". */
const ROW_MAX = 12;

const headingClass = "text-title text-ink";

// The face itself takes the focus ring.
const faceFocus =
  "ring-2 ring-transparent ring-offset-2 ring-offset-bg transition-[transform,box-shadow] duration-240 ease-out-expo group-focus-visible:ring-accent group-active:scale-[0.94]";

/** The "People" row on the Albums screen: face avatars that open a person's photos. */
export default function PeopleRow({ repoKey }: { repoKey: string }) {
  const { people, ready } = usePeople(repoKey);
  const status = useFaceScanStatus();
  if (!ready) return null;

  if (people.length === 0) {
    // Nobody yet: say that faces are being looked for, or stay out of the way.
    if (!scanInProgress(status) || status.repoKey !== repoKey) return null;
    return (
      <section aria-label="People" className="flex flex-col gap-3.5">
        <h2 className={headingClass}>People</h2>
        <div className={`flex animate-fade-in items-center gap-3.5 px-4 py-4 ${cardClass}`}>
          <ProgressRing
            size={44}
            value={status.done}
            max={status.total}
            paused={status.paused}
            ariaLabel="Photos checked for faces"
          >
            <FaceIcon size={18} className="text-accent-text" />
          </ProgressRing>
          <p className="min-w-0 flex-1 text-body font-medium text-ink">{scanHeadline(status)}</p>
        </div>
      </section>
    );
  }

  const shown = people.slice(0, ROW_MAX);
  const more = people.length - shown.length;
  return (
    <section aria-label="People" className="flex flex-col gap-3.5">
      <div className="flex min-h-9 items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className={headingClass}>People</h2>
          <span className="text-footnote tabular-nums text-ink-muted">{people.length.toLocaleString()}</span>
        </div>
        <Link href="/people" className={`${buttonClass({ variant: "ghost", size: "sm" })} -mr-2 !text-accent-text`}>
          See all
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 [&::-webkit-scrollbar]:hidden">
        {shown.map((person) => (
          <li key={person.id} className="w-16 shrink-0 animate-fade-in snap-start">
            <Link
              href={personHref(person.id)}
              aria-label={person.name ?? `Unnamed person, ${person.mediaIds.length} photos`}
              className="group block rounded-full focus-visible:outline-none"
            >
              <FaceAvatar repoKey={repoKey} face={person.cover} className={`h-16 w-16 ${faceFocus}`} />
              <span className={`mt-2 block truncate text-center text-footnote font-medium ${person.name ? "text-ink" : "text-ink-muted"}`}>
                {person.name ?? " "}
              </span>
            </Link>
          </li>
        ))}
        {more > 0 && (
          <li className="w-16 shrink-0 animate-fade-in snap-start">
            <Link
              href="/people"
              aria-label={`See all ${people.length} people`}
              className="group block rounded-full focus-visible:outline-none"
            >
              <span
                className={`flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft text-callout font-semibold tabular-nums text-accent-text ${faceFocus}`}
              >
                +{more.toLocaleString()}
              </span>
              <span className="mt-2 block truncate text-center text-footnote font-medium text-ink-muted">More</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
