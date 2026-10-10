// Per-screen UI state that survives client-side navigation (module scope lives
// as long as the page does), so switching tabs and coming back restores the
// exact view instead of rebuilding it from scratch.

export type LibraryFilter = "all" | "photos" | "videos" | "favorites";

export const galleryView: { filter: LibraryFilter; query: string } = {
  filter: "all",
  query: "",
};

const scrollPositions = new Map<string, number>();
const headerHeights = new Map<string, number>();
let gridWidth = 0;

export function getScrollPosition(key: string): number | undefined {
  return scrollPositions.get(key);
}

export function setScrollPosition(key: string, top: number): void {
  scrollPositions.set(key, top);
}

export function getHeaderHeight(key: string): number {
  return headerHeights.get(key) ?? 0;
}

export function setHeaderHeight(key: string, height: number): void {
  headerHeights.set(key, height);
}

/** Last measured grid width, used for the first render after a remount so the
 * grid has its real height before the browser paints (scroll restore needs it). */
export function getGridWidth(): number {
  return gridWidth;
}

export function setGridWidth(width: number): void {
  gridWidth = width;
}

export const SCROLL_TOP_EVENT = "404gb:scroll-top";

// Lets an album's back button return through history (keeping the list's
// place) when the album was opened from the Albums list.
let albumOpenedFromList: string | null = null;

export function rememberAlbumListOrigin(albumId: string): void {
  albumOpenedFromList = albumId;
}

export function cameFromAlbumList(albumId: string): boolean {
  return albumOpenedFromList === albumId;
}
