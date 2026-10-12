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
import { BackIcon, ClockIcon, DeleteForeverIcon } from "@/app/components/library/icons";

interface TrashClientProps {
  repoOwner: string;
  repoName: string;
}

const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink";

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

  const subtitle = useMemo(() => {
    if (items.length === 0) return `Kept for ${TRASH_RETENTION_DAYS} days`;
    return `${items.length === 1 ? "1 item" : `${items.length.toLocaleString()} items`} · Kept for ${TRASH_RETENTION_DAYS} days`;
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
          <p className="mx-3 mb-1 mt-1 flex animate-fade-in items-center gap-2.5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-small text-ink-muted sm:mx-6">
            <ClockIcon size={16} className="shrink-0" />
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
      header={({ selectMode, startSelect }) => (
        <div className="bg-bg pt-safe sm:pt-0">
          <div className="flex h-14 items-center gap-1 px-2 sm:px-6">
            <button type="button" onClick={goBack} aria-label="Back to albums" className={iconButtonClass}>
              <BackIcon size={20} />
            </button>
            <div className="min-w-0 flex-1 pl-1">
              <h1 className="truncate text-h3 font-semibold tracking-tight text-ink">Trash</h1>
              <p className="truncate text-micro text-ink-muted">{subtitle}</p>
            </div>
            {items.length > 0 && !selectMode && (
              <>
                <button
                  type="button"
                  onClick={() => void emptyTrash()}
                  aria-label="Empty trash"
                  title="Empty trash"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-1.5 rounded-full text-small font-medium text-danger transition-colors duration-180 hover:bg-danger/10 sm:h-9 sm:w-auto sm:px-3"
                >
                  <DeleteForeverIcon size={18} />
                  <span className="hidden sm:inline">Empty trash</span>
                </button>
                <button
                  type="button"
                  onClick={startSelect}
                  className="h-9 shrink-0 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
                >
                  Select
                </button>
              </>
            )}
          </div>
        </div>
      )}
    />
  );
}
