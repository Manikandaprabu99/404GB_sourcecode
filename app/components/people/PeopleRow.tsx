"use client";

import Link from "next/link";
import { personHref, useFaceScanStatus, usePeople } from "@/lib/faces/people";
import { buttonClass } from "@/app/components/ui/Button";
import TileMeter from "@/app/components/ui/TileMeter";
import { IconTile, cardClass } from "@/app/components/library/SettingsBlocks";
import FaceAvatar from "./FaceAvatar";
import { scanHeadline, scanInProgress } from "./scanText";
import { FaceIcon } from "./icons";

/** How many faces the row shows before "More". */
const ROW_MAX = 12;

const headingClass = "font-display text-h2 text-ink";

// The face itself takes the focus ring, in the People colour (docs/DESIGN.md › Albums).
const faceFocus =
  "ring-2 ring-transparent ring-offset-2 ring-offset-bg transition-[transform,box-shadow] duration-250 ease-out-expo group-hover:-translate-y-0.5 group-focus-visible:ring-accent-2 group-active:scale-[0.95]";

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
        <div className={`flex animate-fade-in flex-col gap-3.5 px-4 py-4 ${cardClass}`}>
          <div className="flex items-center gap-3.5">
            <IconTile tone="accent-2">
              <FaceIcon size={18} />
            </IconTile>
            <p className="min-w-0 flex-1 text-body font-medium text-ink">{scanHeadline(status)}</p>
          </div>
          <TileMeter
            fluid
            tiles={20}
            value={status.done}
            max={status.total}
            active={!status.paused}
            ariaLabel="Photos checked for faces"
          />
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
          <span className="telemetry text-ink-muted">{people.length.toLocaleString()}</span>
        </div>
        <Link href="/people" className={`${buttonClass({ variant: "ghost", size: "sm" })} -mr-2 !text-accent`}>
          See all
        </Link>
      </div>
      <ul className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        {shown.map((person) => (
          <li key={person.id} className="w-16 shrink-0 animate-fade-in snap-start">
            <Link
              href={personHref(person.id)}
              aria-label={person.name ?? `Unnamed person, ${person.mediaIds.length} photos`}
              className="group block rounded-full focus-visible:outline-none"
            >
              <FaceAvatar repoKey={repoKey} face={person.cover} className={`h-16 w-16 ${faceFocus}`} />
              <span className={`mt-2 block truncate text-center text-small ${person.name ? "text-ink" : "text-ink-muted"}`}>
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
                className={`telemetry flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-border-strong bg-surface-2 text-ink ${faceFocus}`}
              >
                +{more.toLocaleString()}
              </span>
              <span className="mt-2 block truncate text-center text-small text-ink-muted">More</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
