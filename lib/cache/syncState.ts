// Section 11 sync strategy bookkeeping: the last commit SHA we know the
// client's IndexedDB cache reflects, per repo.

import { getDb } from "./db";
import type { SyncStateRecord } from "./db";

export async function getSyncState(
  repoKey: string
): Promise<SyncStateRecord | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    return (await db.get("syncState", repoKey)) ?? null;
  } catch {
    return null;
  }
}

export async function setSyncState(
  repoKey: string,
  lastKnownSha: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.put("syncState", {
      repoKey,
      lastKnownSha,
      lastManifestFetchAt: Date.now(),
    });
  } catch {
    // Best-effort.
  }
}
