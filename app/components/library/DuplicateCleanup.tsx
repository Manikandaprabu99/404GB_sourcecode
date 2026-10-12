"use client";

import { useMemo } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import type { Album } from "@/lib/albums/types";
import { useAlbums, useLibrary } from "@/lib/library/hooks";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { DuplicateIcon } from "./icons";
import { SettingsRow, rowButtonClass } from "./SettingsBlocks";
import { useMediaActions } from "./useMediaActions";

/**
 * Extra copies of byte-identical files (same SHA-256), among the items shown
 * (copies in Trash don't count). New uploads can't create these any more; they
 * come from uploads made before duplicate checks.
 * Keeps the copy that's in the most albums, then a favorite, then one with a
 * capture date and preview, then the oldest.
 */
export function findDuplicateCopies(
  items: readonly MediaIndexEntry[],
  albums: readonly Album[]
): { extraIds: string[]; files: number } {
  const albumCount = new Map<string, number>();
  for (const album of albums) {
    for (const id of album.mediaIds) albumCount.set(id, (albumCount.get(id) ?? 0) + 1);
  }
  const byHash = new Map<string, MediaIndexEntry[]>();
  for (const item of items) {
    if (!item.hash) continue;
    const copies = byHash.get(item.hash);
    if (copies) copies.push(item);
    else byHash.set(item.hash, [item]);
  }
  const extraIds: string[] = [];
  let files = 0;
  for (const copies of byHash.values()) {
    if (copies.length < 2) continue;
    files++;
    const [keep] = [...copies].sort(
      (a, b) =>
        (albumCount.get(b.id) ?? 0) - (albumCount.get(a.id) ?? 0) ||
        Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) ||
        Number(Boolean(b.takenAt)) - Number(Boolean(a.takenAt)) ||
        Number(Boolean(b.thumb)) - Number(Boolean(a.thumb)) ||
        (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0)
    );
    for (const copy of copies) if (copy.id !== keep.id) extraIds.push(copy.id);
  }
  return { extraIds, files };
}

/** Settings row that finds and removes duplicate copies in the library. */
export default function DuplicateCleanup({ repoKey }: { repoKey: string }) {
  const library = useLibrary(repoKey);
  const albums = useAlbums(repoKey);
  const confirm = useConfirm();
  const { deleteItems } = useMediaActions();
  const { extraIds, files } = useMemo(
    () => findDuplicateCopies(library.items, albums.albums),
    [library.items, albums.albums]
  );
  const count = extraIds.length;
  const ready = library.synced && albums.loaded;

  async function removeExtras() {
    const ok = await confirm({
      title: count === 1 ? "Remove 1 duplicate copy?" : `Remove ${count.toLocaleString()} duplicate copies?`,
      message:
        "One copy of each photo or video stays in your library: the one in your albums or marked favorite. The extra copies go to Trash for 30 days.",
      confirmLabel: "Remove duplicates",
      destructive: true,
    });
    if (ok) deleteItems(extraIds);
  }

  return (
    <SettingsRow
      icon={<DuplicateIcon size={18} />}
      title="Duplicates"
      description={
        !ready
          ? "Checking your library…"
          : count === 0
            ? "None. Every photo and video is in your library once, and new uploads are checked so it stays that way."
            : `${count.toLocaleString()} extra ${count === 1 ? "copy" : "copies"} of ${files.toLocaleString()} ${
                files === 1 ? "file" : "files"
              }, uploaded before duplicate checks existed.`
      }
      trailing={
        ready && count > 0 ? (
          <button type="button" onClick={() => void removeExtras()} className={rowButtonClass}>
            Remove
          </button>
        ) : undefined
      }
    />
  );
}
