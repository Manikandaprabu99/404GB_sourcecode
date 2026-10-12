"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { repoKeyFor } from "@/lib/cache";
import { findCategory } from "@/lib/library/categories";
import { mediaTime } from "@/lib/library/dates";
import { closeOverlaysThen } from "@/lib/library/history";
import { useLibrary } from "@/lib/library/hooks";
import { leaveForSignIn, signedOutAction } from "@/lib/library/signedOut";
import { cameFromAlbumList } from "@/lib/library/viewState";
import EmptyState, { primaryButtonClass } from "@/app/components/library/EmptyState";
import MediaLibraryView from "@/app/components/library/MediaLibraryView";
import { BackIcon } from "@/app/components/library/icons";

interface CategoryClientProps {
  repoOwner: string;
  repoName: string;
  categoryId: string;
}

const iconButtonClass =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink";

function dateRange(newest: number, oldest: number): string {
  if (newest <= 0 || oldest <= 0) return "";
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return format.formatRange(new Date(oldest), new Date(newest));
}

/** An automatic album (Camera, Screenshots, WhatsApp, a device folder…): the library filtered, with the usual grid. */
export default function CategoryClient({ repoOwner, repoName, categoryId }: CategoryClientProps) {
  const repoKey = repoKeyFor(repoOwner, repoName);
  const router = useRouter();
  const library = useLibrary(repoKey);

  useEffect(() => {
    const action = signedOutAction(library.error);
    if (action === "choose-repo") router.replace("/repos");
    else if (action === "sign-in") leaveForSignIn();
  }, [library.error, router]);

  const category = useMemo(() => findCategory(library.items, categoryId), [library.items, categoryId]);
  const items = useMemo(() => category?.items ?? [], [category]);

  const subtitle = useMemo(() => {
    if (items.length === 0) return "";
    const parts = [items.length === 1 ? "1 item" : `${items.length.toLocaleString()} items`];
    const range = dateRange(mediaTime(items[0]), mediaTime(items[items.length - 1]));
    if (range) parts.push(range);
    return parts.join(" · ");
  }, [items]);

  const goBack = () =>
    closeOverlaysThen(() => {
      if (cameFromAlbumList(`category:${categoryId}`) && window.history.length > 1) router.back();
      else router.push("/albums");
    });

  const loading = items.length === 0 && (!library.hydrated || (!library.synced && !library.error));
  const known = Boolean(category);

  return (
    <MediaLibraryView
      repoKey={repoKey}
      scrollKey={`category:${categoryId}`}
      items={items}
      loading={loading}
      empty={
        <EmptyState
          illustration="albums"
          title={known ? `Nothing in ${category?.name} right now` : "Category not found"}
          message={
            known
              ? "Photos and videos show up here as soon as they're backed up or uploaded."
              : "Nothing in your library belongs to it any more."
          }
        >
          <Link href="/albums" className={primaryButtonClass}>
            See all albums
          </Link>
        </EmptyState>
      }
      header={({ selectMode, startSelect }) => (
        <div className="bg-bg pt-safe sm:pt-0">
          <div className="flex h-14 items-center gap-1 px-2 sm:px-6">
            <button type="button" onClick={goBack} aria-label="Back to albums" className={iconButtonClass}>
              <BackIcon size={20} />
            </button>
            <div className="min-w-0 flex-1 pl-1">
              <h1 className="truncate text-h3 font-semibold tracking-tight text-ink">
                {category?.name ?? (loading ? "" : "Category")}
              </h1>
              <p className="truncate text-micro text-ink-muted">{subtitle}</p>
            </div>
            {items.length > 0 && !selectMode && (
              <button
                type="button"
                onClick={startSelect}
                className="h-9 shrink-0 rounded-full px-3 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
              >
                Select
              </button>
            )}
          </div>
        </div>
      )}
    />
  );
}
