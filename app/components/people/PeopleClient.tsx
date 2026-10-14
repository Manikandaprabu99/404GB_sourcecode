"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { repoKeyFor } from "@/lib/cache";
import { personHref, useAllPeople, useFaceScanStatus, type PersonDetails } from "@/lib/faces/people";
import { closeOverlaysThen } from "@/lib/library/history";
import EmptyState, { primaryButtonClass } from "@/app/components/library/EmptyState";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import { cardClass } from "@/app/components/library/SettingsBlocks";
import { BackIcon, ChevronDownIcon } from "@/app/components/library/icons";
import { buttonClass } from "@/app/components/ui/Button";
import IconButton from "@/app/components/ui/IconButton";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import { ProgressRing } from "@/app/components/ui/Progress";
import FaceAvatar from "./FaceAvatar";
import { scanDetail, scanHeadline, scanInProgress } from "./scanText";
import { ScanFaceIcon } from "./icons";

interface PeopleClientProps {
  repoOwner: string;
  repoName: string;
  /** Open with the hidden people listed (from Settings). */
  showHidden: boolean;
}

function photos(count: number): string {
  return count === 1 ? "1 photo" : `${count.toLocaleString()} photos`;
}

function PersonTile({ person, repoKey }: { person: PersonDetails; repoKey: string }) {
  return (
    <li className="animate-fade-in">
      <Link
        href={personHref(person.id)}
        className="pressable group flex flex-col items-center rounded-card px-1 py-2 transition-colors duration-180 hover:bg-surface-2 focus-visible:outline-none"
      >
        <FaceAvatar
          repoKey={repoKey}
          face={person.cover}
          muted={person.hidden}
          className="h-[88px] w-[88px] ring-2 ring-transparent ring-offset-2 ring-offset-bg transition-[box-shadow] duration-240 group-focus-visible:ring-accent sm:h-24 sm:w-24"
        />
        <span className={`mt-2.5 w-full truncate text-center text-callout ${person.name ? "font-semibold text-ink" : "font-medium text-ink-muted"}`}>
          {person.name ?? "Add a name"}
        </span>
        <span className="mt-0.5 text-footnote tabular-nums text-ink-muted">{photos(person.mediaIds.length)}</span>
      </Link>
    </li>
  );
}

/** Everyone found in the library: named first, then by how many photos they're in. */
export default function PeopleClient({ repoOwner, repoName, showHidden }: PeopleClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const { people, ready } = useAllPeople(repoKey);
  const status = useFaceScanStatus();
  const [hiddenOpen, setHiddenOpen] = useState(showHidden);
  const visible = useMemo(() => people.filter((p) => p.visible), [people]);
  const hidden = useMemo(() => people.filter((p) => p.hidden), [people]);

  const goBack = () =>
    closeOverlaysThen(() => {
      if (window.history.length > 1) router.back();
      else router.push("/albums");
    });

  const scanning = scanInProgress(status) && status.repoKey === repoKey;
  const named = visible.filter((p) => p.name).length;
  const grid = "grid grid-cols-3 gap-x-1 gap-y-2 min-[480px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8";

  return (
    <ScrollArea scrollKey="people">
      <PageHeader
        title="People"
        telemetry={
          ready && visible.length > 0 ? (
            <Telemetry
              items={[`${visible.length.toLocaleString()} people`, named > 0 ? `${named.toLocaleString()} named` : null]}
            />
          ) : undefined
        }
        leading={
          <IconButton variant="tile" label="Back" onClick={goBack}>
            <BackIcon size={20} />
          </IconButton>
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 pb-6 pt-2 sm:px-6 lg:px-8">
        {scanning && (
          <div className={`mx-1 flex animate-fade-in items-center gap-3.5 px-4 py-4 ${cardClass}`}>
            <ProgressRing
              size={48}
              stroke={4.5}
              value={status.done}
              max={status.total}
              paused={status.paused}
              ariaLabel="Photos checked for faces"
            >
              <ScanFaceIcon size={18} className="text-accent-text" />
            </ProgressRing>
            <div className="min-w-0 flex-1">
              <p className="text-body font-semibold text-ink">{scanHeadline(status)}</p>
              {scanDetail(status) && <p className="mt-0.5 text-footnote text-ink-muted">{scanDetail(status)}</p>}
            </div>
          </div>
        )}

        {!ready ? (
          <ul aria-busy="true" className={grid}>
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex flex-col items-center px-1 py-2">
                <div className="skeleton h-20 w-20 rounded-full sm:h-24 sm:w-24" />
                <div className="skeleton mt-3 h-3 w-14 rounded-[3px]" />
                <div className="skeleton mt-1.5 h-2.5 w-10 rounded-[3px]" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <EmptyState
            illustration="search"
            title={scanning ? "Finding people…" : "No people yet"}
            message={
              scanning
                ? "Faces are found on this device, a few photos at a time. People show up here once they're in 3 or more photos."
                : "People show up here once they're in 3 or more photos."
            }
          >
            <Link href="/settings" className={primaryButtonClass}>
              Face grouping settings
            </Link>
          </EmptyState>
        ) : (
          <ul className={grid}>
            {visible.map((person) => (
              <PersonTile key={person.id} person={person} repoKey={repoKey} />
            ))}
          </ul>
        )}

        {ready && hidden.length > 0 && (
          <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <button
              type="button"
              onClick={() => setHiddenOpen((open) => !open)}
              aria-expanded={hiddenOpen}
              className={`${buttonClass({ variant: "ghost", size: "sm" })} self-start !text-accent-text`}
            >
              {hiddenOpen ? "Hide hidden people" : `Show hidden people (${hidden.length.toLocaleString()})`}
              <ChevronDownIcon
                size={16}
                className={`transition-transform duration-250 ease-out-expo ${hiddenOpen ? "rotate-180" : ""}`}
              />
            </button>
            {hiddenOpen && (
              <ul className={grid}>
                {hidden.map((person) => (
                  <PersonTile key={person.id} person={person} repoKey={repoKey} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </ScrollArea>
  );
}
