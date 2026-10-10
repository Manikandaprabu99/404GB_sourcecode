import {
  branchReader,
  runTransaction,
  serializeJsonArray,
  type RepoRef,
  type Snapshot,
} from "@/lib/github";
import { MEDIA_INDEX_PATH, type MediaIndexEntry } from "@/lib/media/types";
import { ApiError } from "@/lib/session/api";
import type { Album } from "./types";

export const ALBUMS_PATH = "manifest/albums.json";
const NAME_MAX_LENGTH = 100;

function makeAlbumId(): string {
  return `album_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

/** Tolerates hand-edited or partial entries; anything without an id is dropped. */
export function normalizeAlbums(raw: unknown[]): Album[] {
  const albums: Album[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || !a.id) continue;
    const mediaIds = Array.from(new Set(stringList(a.mediaIds)));
    const createdAt = typeof a.createdAt === "string" ? a.createdAt : new Date(0).toISOString();
    const album: Album = {
      id: a.id,
      name: typeof a.name === "string" ? a.name : "Untitled",
      createdAt,
      updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : createdAt,
      mediaIds,
    };
    if (typeof a.coverId === "string" && mediaIds.includes(a.coverId)) album.coverId = a.coverId;
    albums.push(album);
  }
  return albums;
}

function albumName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
    throw new ApiError(400, `Album name must be 1–${NAME_MAX_LENGTH} characters`);
  }
  return name;
}

/** Drops `ids` from every album (clearing covers that pointed at them). */
export function removeMediaFromAlbums(
  albums: Album[],
  ids: ReadonlySet<string>,
  now: string
): { albums: Album[]; changed: boolean } {
  let changed = false;
  const next = albums.map((album) => {
    if (!album.mediaIds.some((id) => ids.has(id))) return album;
    changed = true;
    const updated: Album = { ...album, mediaIds: album.mediaIds.filter((id) => !ids.has(id)), updatedAt: now };
    if (updated.coverId && ids.has(updated.coverId)) delete updated.coverId;
    return updated;
  });
  return { albums: next, changed };
}

async function readAlbums(reader: { readJsonArray<T>(path: string): Promise<T[]> }): Promise<Album[]> {
  return normalizeAlbums(await reader.readJsonArray<unknown>(ALBUMS_PATH));
}

/** Requested ids that exist in the library, de-duplicated, in request order. */
async function knownMediaIds(snapshot: Snapshot, requested: string[]): Promise<string[]> {
  if (requested.length === 0) return [];
  const index = await snapshot.readJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH);
  const known = new Set(index.map((entry) => entry.id));
  return Array.from(new Set(requested)).filter((id) => known.has(id));
}

function albumsCommit(albums: Album[], message: string) {
  return { blobs: [{ path: ALBUMS_PATH, text: serializeJsonArray(albums) }], message };
}

export async function listAlbums(repo: RepoRef): Promise<Album[]> {
  return readAlbums(branchReader(repo));
}

export async function createAlbum(
  repo: RepoRef,
  input: { name?: unknown; mediaIds?: unknown }
): Promise<Album> {
  const name = albumName(input.name);
  const requested = stringList(input.mediaIds);
  const id = makeAlbumId();

  const { result } = await runTransaction(repo, async (snapshot) => {
    const albums = await readAlbums(snapshot);
    const now = new Date().toISOString();
    const album: Album = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      mediaIds: await knownMediaIds(snapshot, requested),
    };
    return { result: album, commit: albumsCommit([...albums, album], `404gb: create album ${name}`) };
  });
  return result;
}

export interface AlbumPatch {
  name?: unknown;
  addMediaIds?: unknown;
  removeMediaIds?: unknown;
  /** A media id, or null to clear the cover. */
  coverId?: unknown;
}

export async function updateAlbum(repo: RepoRef, albumId: string, patch: AlbumPatch): Promise<Album> {
  const name = patch.name === undefined ? undefined : albumName(patch.name);
  const additions = stringList(patch.addMediaIds);
  const removals = new Set(stringList(patch.removeMediaIds));
  if (patch.coverId !== undefined && patch.coverId !== null && typeof patch.coverId !== "string") {
    throw new ApiError(400, "coverId must be a media id or null");
  }

  const { result } = await runTransaction(repo, async (snapshot) => {
    const albums = await readAlbums(snapshot);
    const current = albums.find((album) => album.id === albumId);
    if (!current) throw new ApiError(404, "Album not found");

    let mediaIds = current.mediaIds.filter((id) => !removals.has(id));
    const present = new Set(mediaIds);
    const toAdd = (await knownMediaIds(snapshot, additions)).filter((id) => !present.has(id));
    mediaIds = [...mediaIds, ...toAdd];

    let coverId = patch.coverId === undefined ? current.coverId : (patch.coverId as string | null) ?? undefined;
    if (coverId && !mediaIds.includes(coverId)) coverId = undefined;
    const nextName = name ?? current.name;

    const unchanged =
      nextName === current.name &&
      coverId === current.coverId &&
      mediaIds.length === current.mediaIds.length &&
      mediaIds.every((id, i) => id === current.mediaIds[i]);
    if (unchanged) return { result: current };

    const updated: Album = { ...current, name: nextName, mediaIds, updatedAt: new Date().toISOString() };
    if (coverId) updated.coverId = coverId;
    else delete updated.coverId;

    const next = albums.map((album) => (album.id === albumId ? updated : album));
    return { result: updated, commit: albumsCommit(next, `404gb: update album ${updated.name}`) };
  });
  return result;
}

/** Deletes the album only — its media stay in the library. False if it didn't exist. */
export async function deleteAlbum(repo: RepoRef, albumId: string): Promise<boolean> {
  const { result } = await runTransaction(repo, async (snapshot) => {
    const albums = await readAlbums(snapshot);
    const target = albums.find((album) => album.id === albumId);
    if (!target) return { result: false };
    const next = albums.filter((album) => album.id !== albumId);
    return { result: true, commit: albumsCommit(next, `404gb: delete album ${target.name}`) };
  });
  return result;
}
