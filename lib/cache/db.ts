// Phase 4 — Local Cache (ARCHITECTURE.md Section 13). A thin `idb` wrapper
// around one IndexedDB database, `404gb`, with three object stores:
//
//   media       — cached manifest/media-index.json entries, scoped per repo
//   thumbnails  — cached thumbnail blobs (id + size -> webp Blob)
//   syncState   — last known repo commit SHA + last manifest fetch time,
//                 one row per repo (Section 11 sync strategy)
//
// This cache is always best-effort: every function here degrades to a no-op
// (or an empty read) if IndexedDB is unavailable (SSR, private browsing,
// disabled storage, etc). The GitHub repo is always the source of truth —
// nothing here is load-bearing for correctness, only for avoiding redundant
// network/GitHub API calls.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { MediaIndexEntry } from "@/lib/media";

export const CACHE_DB_NAME = "404gb";
export const CACHE_DB_VERSION = 1;

/** Multiple repos can be used from the same browser profile (switching via
 * /repos), so every row is namespaced by `${owner}/${repo}`. */
export function repoKeyFor(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

export interface CachedMediaRecord {
  cacheKey: string; // `${repoKey}::${entry.id}`
  repoKey: string;
  entry: MediaIndexEntry;
}

export interface CachedThumbnailRecord {
  cacheKey: string; // `${repoKey}::${mediaId}::${size}`
  repoKey: string;
  mediaId: string;
  size: string;
  blob: Blob;
  cachedAt: number;
}

export interface SyncStateRecord {
  repoKey: string; // primary key — one sync row per repo
  lastKnownSha: string;
  lastManifestFetchAt: number;
}

interface GalleryDB extends DBSchema {
  media: {
    key: string;
    value: CachedMediaRecord;
    indexes: { byRepo: string };
  };
  thumbnails: {
    key: string;
    value: CachedThumbnailRecord;
    indexes: { byRepo: string };
  };
  syncState: {
    key: string;
    value: SyncStateRecord;
  };
}

let dbPromise: Promise<IDBPDatabase<GalleryDB>> | null = null;

/** Resolves to the open database, or null if IndexedDB isn't usable in this
 * context. Callers must treat null as "cache disabled" and fall back to the
 * network, never throw. */
export async function getDb(): Promise<IDBPDatabase<GalleryDB> | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    if (!dbPromise) {
      dbPromise = openDB<GalleryDB>(CACHE_DB_NAME, CACHE_DB_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains("media")) {
            const store = db.createObjectStore("media", { keyPath: "cacheKey" });
            store.createIndex("byRepo", "repoKey");
          }
          if (!db.objectStoreNames.contains("thumbnails")) {
            const store = db.createObjectStore("thumbnails", {
              keyPath: "cacheKey",
            });
            store.createIndex("byRepo", "repoKey");
          }
          if (!db.objectStoreNames.contains("syncState")) {
            db.createObjectStore("syncState", { keyPath: "repoKey" });
          }
        },
      });
    }
    return await dbPromise;
  } catch (err) {
    // Private browsing, storage disabled/quota-exceeded, etc. — cache is
    // best-effort, so just disable it rather than breaking the gallery.
    console.warn("404gb: IndexedDB cache unavailable", err);
    dbPromise = null;
    return null;
  }
}
