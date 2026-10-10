// Cached copy of manifest/media-index.json, per repo (Section 13/11).

import type { MediaIndexEntry } from "@/lib/media";
import { getDb } from "./db";

function cacheKey(repoKey: string, id: string): string {
  return `${repoKey}::${id}`;
}

/** All cached index entries for a repo. Empty array if the cache is empty
 * or unavailable — never a hard failure. */
export async function getCachedMediaIndex(
  repoKey: string
): Promise<MediaIndexEntry[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const records = await db.getAllFromIndex("media", "byRepo", repoKey);
    return records.map((r) => r.entry);
  } catch {
    return [];
  }
}

export interface MediaDiff {
  upserts: MediaIndexEntry[];
  removedIds: string[];
  changed: boolean;
}

/** New, removed, and changed-in-any-field entries (so edits from other devices propagate). */
export function diffMediaIndex(
  cached: MediaIndexEntry[],
  fresh: MediaIndexEntry[]
): MediaDiff {
  const cachedById = new Map(cached.map((e) => [e.id, e]));
  const freshIds = new Set(fresh.map((e) => e.id));

  const upserts: MediaIndexEntry[] = [];
  for (const entry of fresh) {
    const prior = cachedById.get(entry.id);
    if (!prior || !entriesEqual(prior, entry)) {
      upserts.push(entry);
    }
  }
  const removedIds = cached
    .filter((e) => !freshIds.has(e.id))
    .map((e) => e.id);

  return { upserts, removedIds, changed: upserts.length > 0 || removedIds.length > 0 };
}

/** Compares every key either entry has (future fields too); missing equals undefined. */
function entriesEqual(a: MediaIndexEntry, b: MediaIndexEntry): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  for (const key of Object.keys(left)) if (left[key] !== right[key]) return false;
  for (const key of Object.keys(right)) if (!(key in left) && right[key] !== undefined) return false;
  return true;
}

/** Applies a diff (upserts + removals) to the cached media store for a repo. */
export async function applyMediaDiff(
  repoKey: string,
  upserts: MediaIndexEntry[],
  removedIds: string[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction("media", "readwrite");
    const store = tx.objectStore("media");
    await Promise.all([
      ...upserts.map((entry) =>
        store.put({ cacheKey: cacheKey(repoKey, entry.id), repoKey, entry })
      ),
      ...removedIds.map((id) => store.delete(cacheKey(repoKey, id))),
    ]);
    await tx.done;
  } catch {
    // Best-effort — a failed cache write just means the next load re-syncs.
  }
}

/** Wholesale replace of a repo's cached index (used the first time a repo
 * is opened, when there's nothing to diff against yet). */
export async function replaceCachedMediaIndex(
  repoKey: string,
  entries: MediaIndexEntry[]
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const tx = db.transaction("media", "readwrite");
    const store = tx.objectStore("media");
    const existingKeys = await store.index("byRepo").getAllKeys(repoKey);
    await Promise.all(existingKeys.map((k) => store.delete(k)));
    await Promise.all(
      entries.map((entry) =>
        store.put({ cacheKey: cacheKey(repoKey, entry.id), repoKey, entry })
      )
    );
    await tx.done;
  } catch {
    // Best-effort.
  }
}
