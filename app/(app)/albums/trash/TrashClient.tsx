"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { MediaIndexEntry } from "@/lib/media";
import { repoKeyFor } from "@/lib/cache";
import { closeOverlaysThen } from "@/lib/library/history";
import { useLibrary } from "@/lib/library/hooks";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import { daysLeftInTrash, daysLeftLabel, trashedTime, TRASH_RETENTION_DAYS } from "@/lib/library/trash";
import { cameFromAlbumList } from "@/lib/library/viewState";
import { dayLabel, type DateGroup } from "@/app/gallery/dateGroups";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import EmptyState from "@/app/components/library/EmptyState";
import MediaLibraryView from "@/app/components/library/MediaLibraryView";
import { useMediaActions } from "@/app/components/library/useMediaActions";
import {
  SelectButton,
  SubScreenBar,
  SubScreenTitle,
  subScreenHeadingClass,
} from "@/app/components/library/SubScreenHeader";
import { iconButtonClass } from "@/app/components/ui/IconButton";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import { ClockIcon, DeleteForeverIcon } from "@/app/components/library/icons";

interface TrashClientProps {
  repoOwner: string;
  repoName: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Sections by the day items were moved to Trash ("Deleted today", "Deleted Mon, Sep 28"). */
function groupByTrashedDay(items: MediaIndexEntry[], _zoom: unknown, now: Date): DateGroup[] {
  const groups: DateGroup[] = [];
  let current: DateGroup | null = null;
  for (const item of items) {
    const time = trashedTime(item);
    const date = new Date(time);
    const key = time > 0 ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : "unknown";
    if (!current || current.key !== key) {
      const day = time > 0 ? dayLabel(date, now) : "";
      const label = !day ? "Deleted" : day === "Today" || day === "Yesterday" ? `Deleted ${day.toLowerCase()}` : `Deleted ${day}`;
      current = { key, label, time, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

/** Trash: items deleted in the last 30 days, with days left, Restore, Delete forever and Empty trash. */
export default function TrashClient({ repoOwner, repoName }: TrashClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const confirm = useConfirm();
  const library = useLibrary(repoKey);
  const { deleteItemsForever } = useMediaActions();
  const [now, setNow] = useState(() => Date.now());
  const items = library.trashed;

  useEffect(() => {
    const action = signedOutAction(library.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [library.error, router]);

  // Days left tick over when the app comes back to the screen.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const badgeFor = useCallback((item: MediaIndexEntry) => daysLeftLabel(daysLeftInTrash(item, now)), [now]);

  const facts = useMemo(() => {
    const kept = `Kept for ${TRASH_RETENTION_DAYS} days`;
    if (items.length === 0) return [kept];
    return [items.length === 1 ? "1 item" : `${items.length.toLocaleString()} items`, kept];
  }, [items.length]);

  const goBack = () =>
    closeOverlaysThen(() => {
      if (cameFromAlbumList("trash") && window.history.length > 1) router.back();
      else router.push("/albums");
    });

  async function emptyTrash() {
    const ids = items.map((item) => item.id);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: "Empty Trash?",
      message: `${ids.length === 1 ? "1 item is" : `All ${ids.length.toLocaleString()} items are`} removed from your GitHub repo right away. This can't be undone.`,
      confirmLabel: "Empty Trash",
      destructive: true,
    });
    if (ok) void deleteItemsForever(ids);
  }

  const loading = items.length === 0 && (!library.hydrated || (!library.synced && !library.error));

  return (
    <MediaLibraryView
      repoKey={repoKey}
      scrollKey="trash"
      items={items}
      loading={loading}
      mode="trash"
      groupItems={groupByTrashedDay}
      badgeFor={badgeFor}
      aboveGrid={() =>
        items.length > 0 ? (
          <p className="mx-3 mb-2 flex animate-fade-in items-center gap-3 rounded-control bg-surface-2 py-2 pl-2 pr-3.5 text-small text-ink-muted sm:mx-6">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-tile bg-surface-3">
              <ClockIcon size={16} />
            </span>
            Items are deleted for good {TRASH_RETENTION_DAYS} days after they&apos;re moved here. The corner of each one
            shows the days it has left.
          </p>
        ) : null
      }
      empty={
        <EmptyState
          illustration="trash"
          title="Trash is empty"
          message={`Photos and videos you delete wait here for ${TRASH_RETENTION_DAYS} days, so you can change your mind. Then they're deleted for good.`}
        />
      }
      contained
      header={({ selectMode, startSelect, collapsed }) => (
        <SubScreenBar
          backLabel="Back to albums"
          onBack={goBack}
          title="Trash"
          collapsed={collapsed}
          actions={
            items.length > 0 && !selectMode ? (
              <>
                <button
                  type="button"
                  onClick={() => void emptyTrash()}
                  aria-label="Empty trash"
                  title="Empty trash"
                  className={`${iconButtonClass({ variant: "tile", size: 40 })} !text-danger hover:!bg-danger/10 sm:w-auto sm:gap-2 sm:px-3`}
                >
                  <DeleteForeverIcon size={18} />
                  <span className="hidden text-small font-medium sm:inline">Empty trash</span>
                </button>
                <SelectButton onClick={startSelect} />
              </>
            ) : undefined
          }
        />
      )}
      intro={() => (
        <SubScreenTitle
          title={<h1 className={subScreenHeadingClass}>Trash</h1>}
          telemetry={<Telemetry items={facts} />}
        />
      )}
    />
  );
}
