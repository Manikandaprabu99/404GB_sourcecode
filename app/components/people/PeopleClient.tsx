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
import { BackIcon } from "@/app/components/library/icons";
import FaceAvatar from "./FaceAvatar";
import { scanDetail, scanFraction, scanHeadline, scanInProgress } from "./scanText";

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
        className="group flex flex-col items-center rounded-2xl p-2 outline-none transition-colors duration-180 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <FaceAvatar
          repoKey={repoKey}
          face={person.cover}
          muted={person.hidden}
          className="h-20 w-20 transition-transform duration-250 ease-out-expo group-active:scale-95 sm:h-24 sm:w-24"
        />
        <span className={`mt-2 w-full truncate text-center text-small font-medium ${person.name ? "text-ink" : "text-ink-muted"}`}>
          {person.name ?? "Add a name"}
        </span>
        <span className="text-micro text-ink-faint">{photos(person.mediaIds.length)}</span>
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
  const grid = "grid grid-cols-3 gap-x-1 gap-y-3 min-[480px]:grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8";

  return (
    <ScrollArea scrollKey="people">
      <PageHeader
        title="People"
        subtitle={ready && visible.length > 0 ? `${visible.length.toLocaleString()} people` : undefined}
        leading={
          <button
            type="button"
            onClick={goBack}
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          >
            <BackIcon size={20} />
          </button>
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-3 pb-6 pt-2 sm:px-6">
        {scanning && (
          <div className="mx-1 animate-fade-in rounded-2xl border border-border bg-surface px-4 py-3">
            <p className="text-small font-medium text-ink">{scanHeadline(status)}</p>
            {scanDetail(status) && <p className="mt-0.5 text-micro text-ink-muted">{scanDetail(status)}</p>}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-320 ease-out-expo"
                style={{ width: `${Math.max(2, scanFraction(status) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {!ready ? (
          <ul aria-busy="true" className={grid}>
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex flex-col items-center p-2">
                <div className="skeleton h-20 w-20 rounded-full sm:h-24 sm:w-24" />
                <div className="skeleton mt-2.5 h-3 w-14 rounded-full" />
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
          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setHiddenOpen((open) => !open)}
              aria-expanded={hiddenOpen}
              className="self-start rounded-full px-3 py-1.5 text-small font-medium text-accent transition-colors duration-180 hover:bg-accent/10"
            >
              {hiddenOpen ? "Hide hidden people" : `Show hidden people (${hidden.length.toLocaleString()})`}
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
