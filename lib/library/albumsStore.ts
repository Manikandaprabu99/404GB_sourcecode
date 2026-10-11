// App-wide albums list (manifest/albums.json in the repo). Cached in localStorage per
// repo so the Albums tab paints instantly, and every edit is optimistic with a rollback
// when the commit fails.

import * as repoAlbums from "@/lib/albums";
import type { Album } from "@/lib/albums/types";
import { retryWhenBusy, toLibraryError, withRepo, type LibraryError } from "./api";
import { onSessionChange } from "@/lib/session";
import { onMediaDeleted } from "./mediaStore";

export interface AlbumsSnapshot {
  repoKey: string | null;
  albums: Album[];
  /** The repo's list arrived since the page loaded (cached albums may be stale before that). */
  loaded: boolean;
  loading: boolean;
  error: LibraryError | null;
}

const EMPTY: AlbumsSnapshot = { repoKey: null, albums: [], loaded: false, loading: false, error: null };
const STORAGE_PREFIX = "404gb-albums:";
const RELOAD_MIN_INTERVAL_MS = 15_000;

let snapshot: AlbumsSnapshot = EMPTY;
let generation = 0;
let inflight: Promise<void> | null = null;
let lastLoadAt = 0;
let lastMutationAt = 0;
let mutationChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function readCached(repoKey: string): Album[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + repoKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Album[]) : [];
  } catch {
    return [];
  }
}

function writeCached(repoKey: string, albums: Album[]) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + repoKey, JSON.stringify(albums));
  } catch {
    // Storage full or disabled: the list just isn't instant next time.
  }
}

function set(patch: Partial<AlbumsSnapshot>) {
  const albumsChanged = patch.albums !== undefined && patch.albums !== snapshot.albums;
  snapshot = { ...snapshot, ...patch };
  if (albumsChanged && snapshot.repoKey) writeCached(snapshot.repoKey, snapshot.albums);
  for (const listener of listeners) listener();
}

export function subscribeAlbums(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAlbumsSnapshot(): AlbumsSnapshot {
  return snapshot;
}

export function getServerAlbumsSnapshot(): AlbumsSnapshot {
  return EMPTY;
}

export function ensureAlbums(repoKey: string): void {
  if (snapshot.repoKey === repoKey) return;
  generation += 1;
  inflight = null;
  lastLoadAt = 0;
  snapshot = { ...EMPTY, repoKey, albums: readCached(repoKey) };
  for (const listener of listeners) listener();
}

/** Forgets the albums in memory (signing out). */
export function resetAlbums(): void {
  generation += 1;
  inflight = null;
  lastLoadAt = 0;
  snapshot = EMPTY;
  for (const listener of listeners) listener();
}

/** Where an album opens (a query parameter: the static export has no dynamic routes). */
export function albumHref(albumId: string): string {
  return `/albums/view?id=${encodeURIComponent(albumId)}`;
}

export function loadAlbums(options: { force?: boolean } = {}): Promise<void> {
  if (!snapshot.repoKey) return Promise.resolve();
  if (inflight) return inflight;
  if (!options.force && snapshot.loaded && Date.now() - lastLoadAt < RELOAD_MIN_INTERVAL_MS) {
    return Promise.resolve();
  }
  const gen = generation;
  const key = snapshot.repoKey ?? undefined;
  const startedAt = Date.now();
  set({ loading: true });
  const run: Promise<void> = withRepo((repo) => repoAlbums.listAlbums(repo), key)
    .then((albums) => {
      if (gen !== generation) return;
      lastLoadAt = Date.now();
      // An edit made while this was in flight already has the newer copy.
      if (lastMutationAt > startedAt) set({ loaded: true, loading: false, error: null });
      else set({ albums, loaded: true, loading: false, error: null });
    })
    .catch((err: unknown) => {
      if (gen !== generation) return;
      set({ loading: false, error: toLibraryError(err) });
    })
    .finally(() => {
      if (inflight === run) inflight = null;
    });
  inflight = run;
  return run;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(task, task);
  mutationChain = next.catch(() => undefined);
  return next;
}

function replaceAlbum(album: Album) {
  set({ albums: snapshot.albums.map((a) => (a.id === album.id ? album : a)) });
}

async function mutateAlbum(
  id: string,
  optimistic: (album: Album) => Album,
  patch: repoAlbums.AlbumPatch
): Promise<Album> {
  const before = snapshot.albums.find((a) => a.id === id);
  if (!before) throw new Error("This album no longer exists.");
  const gen = generation;
  const key = snapshot.repoKey ?? undefined;
  lastMutationAt = Date.now();
  replaceAlbum(optimistic(before));
  try {
    const album = await enqueue(() =>
      retryWhenBusy(() => withRepo((repo) => repoAlbums.updateAlbum(repo, id, patch), key))
    );
    if (gen === generation && snapshot.albums.some((a) => a.id === id)) replaceAlbum(album);
    return album;
  } catch (err) {
    if (gen === generation && snapshot.albums.some((a) => a.id === id)) replaceAlbum(before);
    throw err;
  }
}

export async function createAlbum(name: string, mediaIds: readonly string[] = []): Promise<Album> {
  const gen = generation;
  const key = snapshot.repoKey ?? undefined;
  lastMutationAt = Date.now();
  const album = await enqueue(() =>
    retryWhenBusy(() => withRepo((repo) => repoAlbums.createAlbum(repo, { name, mediaIds: [...mediaIds] }), key))
  );
  if (gen === generation) {
    set({ albums: [album, ...snapshot.albums.filter((a) => a.id !== album.id)] });
  }
  return album;
}

export function renameAlbum(id: string, name: string): Promise<Album> {
  return mutateAlbum(id, (album) => ({ ...album, name }), { name });
}

export function addToAlbum(id: string, mediaIds: readonly string[]): Promise<Album> {
  return mutateAlbum(
    id,
    (album) => {
      const existing = new Set(album.mediaIds);
      return { ...album, mediaIds: [...album.mediaIds, ...mediaIds.filter((m) => !existing.has(m))] };
    },
    { addMediaIds: mediaIds }
  );
}

export function removeFromAlbum(id: string, mediaIds: readonly string[]): Promise<Album> {
  const removed = new Set(mediaIds);
  return mutateAlbum(
    id,
    (album) => ({
      ...album,
      mediaIds: album.mediaIds.filter((m) => !removed.has(m)),
      coverId: album.coverId && removed.has(album.coverId) ? undefined : album.coverId,
    }),
    { removeMediaIds: mediaIds }
  );
}

export function setAlbumCover(id: string, mediaId: string): Promise<Album> {
  return mutateAlbum(id, (album) => ({ ...album, coverId: mediaId }), { coverId: mediaId });
}

export async function deleteAlbum(id: string): Promise<void> {
  const index = snapshot.albums.findIndex((a) => a.id === id);
  if (index < 0) return;
  const album = snapshot.albums[index];
  const gen = generation;
  const key = snapshot.repoKey ?? undefined;
  lastMutationAt = Date.now();
  set({ albums: snapshot.albums.filter((a) => a.id !== id) });
  try {
    // False means it was already gone, which is what the user asked for.
    await enqueue(() => retryWhenBusy(() => withRepo((repo) => repoAlbums.deleteAlbum(repo, id), key)));
  } catch (err) {
    if (gen === generation && !snapshot.albums.some((a) => a.id === id)) {
      const albums = [...snapshot.albums];
      albums.splice(Math.min(index, albums.length), 0, album);
      set({ albums });
    }
    throw err;
  }
}

/** The cover shown for an album: its chosen cover, else its first item. */
export function albumCoverId(album: Album): string | undefined {
  if (album.coverId && album.mediaIds.includes(album.coverId)) return album.coverId;
  return album.mediaIds[0];
}

// Deleting media drops it from albums in the same commit; mirror that locally.
onMediaDeleted((ids) => {
  const gone = new Set(ids);
  let changed = false;
  const albums = snapshot.albums.map((album) => {
    if (!album.mediaIds.some((m) => gone.has(m))) return album;
    changed = true;
    return {
      ...album,
      mediaIds: album.mediaIds.filter((m) => !gone.has(m)),
      coverId: album.coverId && gone.has(album.coverId) ? undefined : album.coverId,
    };
  });
  if (changed) set({ albums });
});

// See mediaStore: a new sign-in or repo choice clears a stale "signed out" error.
onSessionChange(() => {
  if (snapshot.error?.kind === "auth") set({ error: null });
});
