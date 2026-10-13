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
import {
  SelectButton,
  SubScreenBar,
  SubScreenTitle,
  subScreenHeadingClass,
} from "@/app/components/library/SubScreenHeader";
import { Telemetry } from "@/app/components/ui/SectionLabel";

interface CategoryClientProps {
  repoOwner: string;
  repoName: string;
  categoryId: string;
}

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

  const facts = useMemo(() => {
    if (items.length === 0) return [];
    const parts = [items.length === 1 ? "1 item" : `${items.length.toLocaleString()} items`];
    const range = dateRange(mediaTime(items[0]), mediaTime(items[items.length - 1]));
    if (range) parts.push(range);
    return parts;
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
      contained
      header={({ selectMode, startSelect, collapsed }) => (
        <SubScreenBar
          backLabel="Back to albums"
          onBack={goBack}
          title={category?.name ?? ""}
          collapsed={collapsed}
          actions={items.length > 0 && !selectMode ? <SelectButton onClick={startSelect} /> : undefined}
        />
      )}
      intro={() => (
        <SubScreenTitle
          title={<h1 className={subScreenHeadingClass}>{category?.name ?? (loading ? "" : "Category")}</h1>}
          telemetry={
            facts.length > 0 ? (
              <Telemetry items={facts} className="whitespace-normal" />
            ) : loading ? (
              <span className="skeleton block h-2.5 w-40 rounded-[3px]" />
            ) : undefined
          }
        />
      )}
    />
  );
}
