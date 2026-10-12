// This device's face data, in its own IndexedDB database (404gb-faces) so the shared cache's
// schema stays untouched. Best-effort like lib/cache: without IndexedDB everything still works,
// just without the head start on the next visit.
//
//   docs     the last faces.json read or written, per repo (text + blob/commit sha)
//   pending  operations not committed yet, per repo (replayed on the next commit)
//   scans    what the detector found per media item and model (or why it couldn't), so a lost
//            commit or a reset file never means running the model again

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FacesOp, ScannedFace } from "./cluster";

export const FACES_DB_NAME = "404gb-faces";
const FACES_DB_VERSION = 1;

export interface StoredDoc {
  repoKey: string;
  text: string | null;
  blobSha: string | null;
  commitSha: string | null;
  savedAt: number;
}

export interface StoredPending {
  repoKey: string;
  ops: FacesOp[];
}

export interface StoredScan {
  key: string; // `${repoKey}::${mediaId}`
  repoKey: string;
  mediaId: string;
  model: string;
  faces: ScannedFace[] | null;
  /** Why the item couldn't be scanned ("no-thumbnail", "decode"); retried by Re-scan. */
  failed?: string;
  at: number;
}

interface FacesDB extends DBSchema {
  docs: { key: string; value: StoredDoc };
  pending: { key: string; value: StoredPending };
  scans: { key: string; value: StoredScan; indexes: { byRepo: string } };
}

let dbPromise: Promise<IDBPDatabase<FacesDB>> | null = null;

async function db(): Promise<IDBPDatabase<FacesDB> | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    dbPromise ??= openDB<FacesDB>(FACES_DB_NAME, FACES_DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("docs")) database.createObjectStore("docs", { keyPath: "repoKey" });
        if (!database.objectStoreNames.contains("pending")) {
          database.createObjectStore("pending", { keyPath: "repoKey" });
        }
        if (!database.objectStoreNames.contains("scans")) {
          database.createObjectStore("scans", { keyPath: "key" }).createIndex("byRepo", "repoKey");
        }
      },
      blocking() {
        // Another tab wants to upgrade or delete (sign-out): let it.
        void closeFacesDb();
      },
    });
    return await dbPromise;
  } catch {
    dbPromise = null;
    return null;
  }
}

export async function closeFacesDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  try {
    (await pending)?.close();
  } catch {
    // Never opened.
  }
}

export async function readDoc(repoKey: string): Promise<StoredDoc | null> {
  try {
    return (await (await db())?.get("docs", repoKey)) ?? null;
  } catch {
    return null;
  }
}

export async function writeDoc(doc: StoredDoc): Promise<void> {
  try {
    await (await db())?.put("docs", doc);
  } catch {
    // Best-effort.
  }
}

export async function readPending(repoKey: string): Promise<FacesOp[]> {
  try {
    return (await (await db())?.get("pending", repoKey))?.ops ?? [];
  } catch {
    return [];
  }
}

export async function writePending(repoKey: string, ops: FacesOp[]): Promise<void> {
  try {
    const database = await db();
    if (!database) return;
    if (ops.length === 0) await database.delete("pending", repoKey);
    else await database.put("pending", { repoKey, ops });
  } catch {
    // Best-effort: the scans store still has every result.
  }
}

export async function readScans(repoKey: string): Promise<StoredScan[]> {
  try {
    return (await (await db())?.getAllFromIndex("scans", "byRepo", repoKey)) ?? [];
  } catch {
    return [];
  }
}

export async function writeScan(scan: Omit<StoredScan, "key">): Promise<void> {
  try {
    await (await db())?.put("scans", { ...scan, key: `${scan.repoKey}::${scan.mediaId}` });
  } catch {
    // Best-effort.
  }
}

/** Forgets this device's scan results for a repo (Re-scan). */
export async function clearScans(repoKey: string): Promise<void> {
  try {
    const database = await db();
    if (!database) return;
    const tx = database.transaction("scans", "readwrite");
    let cursor = await tx.store.index("byRepo").openCursor(repoKey);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  } catch {
    // Best-effort.
  }
}
