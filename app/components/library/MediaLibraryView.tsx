"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import type { Album } from "@/lib/albums/types";
import MediaViewer from "@/app/gallery/MediaViewer";
import VirtualGrid from "@/app/gallery/VirtualGrid";
import { groupMedia, type DateGroup } from "@/app/gallery/dateGroups";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { useToast } from "@/app/components/ui/Toast";
import { addToAlbum, removeFromAlbum, setAlbumCover } from "@/lib/library/albumsStore";
import { afterOverlayClosed } from "@/lib/library/history";
import { useIsomorphicLayoutEffect } from "@/lib/library/hooks";
import { syncLibrary } from "@/lib/library/mediaStore";
import { getHeaderHeight, getScrollPosition, setHeaderHeight } from "@/lib/library/viewState";
import { stepZoom, useZoom, type ZoomLevel } from "@/lib/library/zoom";
import AddToAlbumSheet from "./AddToAlbumSheet";
import ScrollArea from "./ScrollArea";
import SelectionBar, { type SelectionAction } from "./SelectionBar";
import SkeletonGrid from "./SkeletonGrid";
import {
  AlbumAddIcon,
  AlbumRemoveIcon,
  CoverIcon,
  DeleteForeverIcon,
  HeartIcon,
  RestoreIcon,
  TrashIcon,
} from "./icons";
import { useMediaActions } from "./useMediaActions";
import { useSelection } from "./useSelection";

export interface LibraryHeaderState {
  selectMode: boolean;
  startSelect: () => void;
}

interface MediaLibraryViewProps {
  repoKey: string;
  /** Scroll position and header height are remembered under this key. */
  scrollKey: string;
  /** What the grid shows, newest first. */
  items: MediaIndexEntry[];
  /** Cold load: show skeleton tiles instead of the grid. */
  loading: boolean;
  header: (state: LibraryHeaderState) => ReactNode;
  /** Banner between the header and the grid. */
  notice?: ReactNode;
  /** Shown when not loading and there is nothing to show. */
  empty: ReactNode;
  /** Scrolls back to the top when it changes (a new filter or search). */
  resetKey?: string;
  /** Album context: adds remove-from-album and set-cover actions. */
  album?: Album;
  /** "trash": Restore and Delete forever replace the library's actions (grid and viewer). */
  mode?: "library" | "trash";
  /** How the grid is split into dated sections (by when it was taken, unless given). */
  groupItems?: (items: MediaIndexEntry[], zoom: ZoomLevel, now: Date) => DateGroup[];
  /** A corner label per tile, e.g. days left in Trash. */
  badgeFor?: (item: MediaIndexEntry) => string | null;
  /** Content between the notice and the grid; `openSet` opens the viewer over one of `viewerSets`. */
  aboveGrid?: (state: { selectMode: boolean; openSet: (setKey: string, id: string) => void }) => ReactNode;
  /** Other lists the viewer can page through (e.g. a memory), by key; kept current by the caller. */
  viewerSets?: Record<string, MediaIndexEntry[]>;
  /** Screen-specific selection actions (e.g. a person's "Not this person"), placed before Delete. */
  extraActions?: (selectedIds: string[], exitSelection: () => void) => SelectionAction[];
}

const NO_SETS: Record<string, MediaIndexEntry[]> = {};

function itemsLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

export default function MediaLibraryView({
  repoKey,
  scrollKey,
  items,
  loading,
  header,
  notice,
  empty,
  resetKey,
  album,
  mode = "library",
  groupItems = groupMedia,
  badgeFor,
  aboveGrid,
  viewerSets = NO_SETS,
  extraActions,
}: MediaLibraryViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const inTrash = mode === "trash";
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [stickyTop, setStickyTop] = useState(() => getHeaderHeight(scrollKey));
  const [now, setNow] = useState(() => Date.now());
  const selection = useSelection(items);
  const { deleteItems, restoreItems, deleteItemsForever, setFavorite } = useMediaActions();
  const [openId, setOpenId] = useState<string | null>(null);
  // Which list the viewer pages through: the grid's (null) or one of viewerSets.
  const [openSetKey, setOpenSetKey] = useState<string | null>(null);
  const [pickerIds, setPickerIds] = useState<readonly string[] | null>(null);
  const focusAfterEditRef = useRef<string | null>(null);
  const zoom = useZoom();
  const [scrubberHost, setScrubberHost] = useState<HTMLDivElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => {
      const height = el.offsetHeight;
      setHeaderHeight(scrollKey, height);
      setStickyTop((prev) => (prev === height ? prev : height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollKey]);

  // Day labels ("Today", "Yesterday") roll over when the app comes back after midnight.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const skipResetRef = useRef(true);
  useEffect(() => {
    if (skipResetRef.current) {
      skipResetRef.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const groups = useMemo(() => groupItems(items, zoom, new Date(now)), [groupItems, items, zoom, now]);
  const viewerItems = openSetKey === null ? items : (viewerSets[openSetKey] ?? []);
  const indexById = useMemo(() => new Map(viewerItems.map((item, index) => [item.id, index])), [viewerItems]);
  const openIndex = openId === null ? -1 : (indexById.get(openId) ?? -1);

  const openSet = useCallback((setKey: string, id: string) => {
    setOpenSetKey(setKey);
    setOpenId(id);
  }, []);
  const openInGrid = useCallback((id: string) => {
    setOpenSetKey(null);
    setOpenId(id);
  }, []);

  // The open item vanished underneath the viewer (deleted elsewhere, synced away).
  useEffect(() => {
    if (openId !== null && openIndex < 0) setOpenId(null);
  }, [openId, openIndex]);

  // After an edit is saved, jump to the new copy once the sync brings it in.
  useEffect(() => {
    const target = focusAfterEditRef.current;
    if (target && indexById.has(target)) {
      focusAfterEditRef.current = null;
      setOpenId((current) => (current === null ? current : target));
    }
  }, [indexById]);

  /** The item to show after `gone` leave the list while the viewer is open. */
  const neighborOf = useCallback(
    (id: string, gone: ReadonlySet<string>): string | null => {
      const index = indexById.get(id) ?? -1;
      for (let i = index + 1; i < viewerItems.length; i++) if (!gone.has(viewerItems[i].id)) return viewerItems[i].id;
      for (let i = index - 1; i >= 0; i--) if (!gone.has(viewerItems[i].id)) return viewerItems[i].id;
      return null;
    },
    [indexById, viewerItems]
  );

  const handleViewerDelete = useCallback(
    (ids: string[]) => {
      const gone = new Set(ids);
      if (openId !== null && gone.has(openId)) setOpenId(neighborOf(openId, gone));
      deleteItems(ids);
    },
    [openId, neighborOf, deleteItems]
  );

  const handleViewerRestore = useCallback(
    (id: string) => {
      if (openId === id) setOpenId(neighborOf(id, new Set([id])));
      void restoreItems([id]);
    },
    [openId, neighborOf, restoreItems]
  );

  const handleViewerDeleteForever = useCallback(
    (id: string) => {
      if (openId === id) setOpenId(neighborOf(id, new Set([id])));
      void deleteItemsForever([id]);
    },
    [openId, neighborOf, deleteItemsForever]
  );

  const handleFavoriteChange = useCallback(
    (id: string, favorite: boolean) => {
      void setFavorite([id], favorite);
    },
    [setFavorite]
  );

  const handleEdited = useCallback((newMediaId: string | null) => {
    focusAfterEditRef.current = newMediaId;
    void syncLibrary();
  }, []);

  const removeFromThisAlbum = useCallback(
    (ids: readonly string[]) => {
      if (!album || ids.length === 0) return;
      const { id: albumId, name } = album;
      const handle = toast({
        message: `Removed ${itemsLabel(ids.length)} from ${name}`,
        actionLabel: "Undo",
        onAction: () => {
          addToAlbum(albumId, ids).catch(() =>
            toast({ tone: "error", message: `Couldn't put them back in ${name}.` })
          );
        },
        durationMs: 5000,
      });
      removeFromAlbum(albumId, ids).catch(() => {
        handle.dismiss();
        toast({ tone: "error", message: `Couldn't remove from ${name}. Try again.` });
      });
    },
    [album, toast]
  );

  const handleViewerRemoveFromAlbum = useCallback(
    (id: string) => {
      if (openId === id) setOpenId(neighborOf(id, new Set([id])));
      removeFromThisAlbum([id]);
    },
    [openId, neighborOf, removeFromThisAlbum]
  );

  const toggleGroup = useCallback(
    (groupKey: string) => {
      const group = groups.find((g) => g.key === groupKey);
      if (!group) return;
      const ids = group.items.map((item) => item.id);
      const allSelected = ids.every((id) => selection.selectedIds.has(id));
      selection.setMany(ids, !allSelected);
    },
    [groups, selection]
  );

  const selectedIds = useMemo(
    () => items.filter((item) => selection.selectedIds.has(item.id)).map((item) => item.id),
    [items, selection.selectedIds]
  );
  const allFavorite = useMemo(
    () => selectedIds.length > 0 && items.every((item) => !selection.selectedIds.has(item.id) || item.favorite),
    [items, selection.selectedIds, selectedIds.length]
  );

  async function confirmDeleteForever(ids: string[]) {
    const ok = await confirm({
      title: ids.length === 1 ? "Delete 1 item forever?" : `Delete ${ids.length.toLocaleString()} items forever?`,
      message: "They're removed from your GitHub repo right away. This can't be undone.",
      confirmLabel: "Delete forever",
      destructive: true,
    });
    if (!ok) return;
    selection.exit();
    void deleteItemsForever(ids);
  }

  const trashActions: SelectionAction[] = [
    {
      key: "restore",
      label: "Restore",
      icon: <RestoreIcon size={20} />,
      onClick: () => {
        void restoreItems(selectedIds);
        selection.exit();
      },
    },
    {
      key: "delete-forever",
      label: "Delete forever",
      icon: <DeleteForeverIcon size={20} />,
      tone: "danger",
      onClick: () => void confirmDeleteForever(selectedIds),
    },
  ];

  const actions: SelectionAction[] = [
    {
      key: "favorite",
      label: allFavorite ? "Remove from favorites" : "Add to favorites",
      icon: <HeartIcon size={20} filled={allFavorite} />,
      onClick: () => {
        void setFavorite(selectedIds, !allFavorite);
        selection.exit();
      },
    },
    {
      key: "add-to-album",
      label: "Add to album",
      icon: <AlbumAddIcon size={20} />,
      overflow: Boolean(album),
      onClick: () => setPickerIds(selectedIds),
    },
  ];
  if (album) {
    actions.push(
      {
        key: "remove-from-album",
        label: "Remove from album",
        icon: <AlbumRemoveIcon size={20} />,
        onClick: () => {
          removeFromThisAlbum(selectedIds);
          selection.exit();
        },
      },
      {
        key: "cover",
        label: "Use as album cover",
        icon: <CoverIcon size={20} />,
        overflow: true,
        disabled: selectedIds.length !== 1,
        onClick: () => {
          const [coverId] = selectedIds;
          selection.exit();
          setAlbumCover(album.id, coverId).then(
            () => toast({ tone: "success", message: "Album cover updated" }),
            () => toast({ tone: "error", message: "Couldn't change the cover. Try again." })
          );
        },
      }
    );
  }
  if (extraActions) actions.push(...extraActions(selectedIds, selection.exit));
  actions.push({
    key: "delete",
    label: "Delete",
    icon: <TrashIcon size={20} />,
    tone: "danger",
    onClick: () => {
      deleteItems(selectedIds);
      selection.exit();
    },
  });

  return (
    <>
      <div className="relative h-full">
      <ScrollArea
        ref={scrollRef}
        scrollKey={scrollKey}
        restore={false}
        selectionInset={selection.active}
        // The timeline scrubber replaces the scrollbar; pinches switch views instead of zooming the page.
        className="touch-pan-y [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div ref={headerRef} className="sticky top-0 z-30">
          {header({ selectMode: selection.active, startSelect: () => selection.start() })}
        </div>
        {notice}
        {!loading && aboveGrid?.({ selectMode: selection.active, openSet })}
        <div className="sm:px-6">
          {loading ? (
            <SkeletonGrid />
          ) : items.length === 0 ? (
            empty
          ) : (
            <VirtualGrid
              groups={groups}
              zoom={zoom}
              onZoomStep={stepZoom}
              scrubberHost={scrubberHost}
              repoKey={repoKey}
              scrollRef={scrollRef}
              stickyTop={stickyTop}
              initialScrollTop={getScrollPosition(scrollKey)}
              selectMode={selection.active}
              selectedIds={selection.selectedIds}
              onOpen={openInGrid}
              onToggleSelect={selection.toggle}
              onStartSelect={selection.start}
              onToggleGroup={toggleGroup}
              badgeFor={badgeFor}
            />
          )}
        </div>
      </ScrollArea>
      <div
        ref={setScrubberHost}
        aria-hidden={items.length === 0 || undefined}
        className={`pointer-events-none absolute right-0 z-20 w-40 transition-[bottom] duration-250 ease-out-expo ${
          selection.active
            ? "bottom-[calc(9.25rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] sm:bottom-[calc(6.75rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
            : "bottom-[calc(5rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))] sm:bottom-[calc(2.25rem+var(--safe-area-inset-bottom,env(safe-area-inset-bottom,0px)))]"
        }`}
        style={{ top: stickyTop + 8 }}
      />
      </div>

      {selection.active && (
        <SelectionBar
          count={selectedIds.length}
          allSelected={selection.allSelected}
          onSelectAll={selection.selectAll}
          onDeselectAll={selection.clear}
          onCancel={selection.exit}
          actions={inTrash ? trashActions : actions}
        />
      )}

      {openIndex >= 0 && (
        <MediaViewer
          items={viewerItems}
          index={openIndex}
          repoKey={repoKey}
          onIndexChange={(index: number) => {
            const next = viewerItems[index];
            if (next) setOpenId(next.id);
          }}
          onClose={() => setOpenId(null)}
          onDelete={handleViewerDelete}
          onFavoriteChange={handleFavoriteChange}
          onAddToAlbum={(ids: string[]) => setPickerIds(ids)}
          onEdited={handleEdited}
          onRemoveFromAlbum={album && openSetKey === null ? handleViewerRemoveFromAlbum : undefined}
          trash={inTrash ? { onRestore: handleViewerRestore, onDeleteForever: handleViewerDeleteForever } : undefined}
        />
      )}

      <AddToAlbumSheet
        repoKey={repoKey}
        mediaIds={pickerIds}
        onClose={() => setPickerIds(null)}
        onAdded={selection.active ? () => afterOverlayClosed(selection.exit) : undefined}
        excludeAlbumId={album?.id}
      />
    </>
  );
}
