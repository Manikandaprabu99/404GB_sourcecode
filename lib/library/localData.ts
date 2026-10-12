// Removes the signed-in user's library from this device when they sign out: the in-memory
// stores, the IndexedDB index/thumbnail cache, cached album lists, unfinished-upload notes
// and the service worker's chunk and record caches. Best-effort; never throws.

import { CACHE_DB_NAME, closeDb } from "@/lib/cache/db";
import { closeFacesDb, FACES_DB_NAME } from "@/lib/faces/idb";
import { resetFaces } from "@/lib/faces/store";
import { clearBlobTextCache } from "@/lib/github/blobCache";
import { PURGE_MESSAGE, postToServiceWorker } from "@/lib/media/stream";
import { getUploadQueue } from "@/lib/upload/queueSingleton";
import { resetAlbums } from "./albumsStore";
import { resetLibrary } from "./mediaStore";
import { clearThumbUrls } from "./thumbUrls";

const LOCAL_KEYS = ["404gb-pending-deletes", "404gb:uploadProgress:v2"];
const LOCAL_PREFIXES = ["404gb-albums:", "404gb-faces:"];
const USER_CACHE_PREFIXES = ["404gb-thumbs", "404gb-chunks", "404gb-records"];

function deleteDatabase(name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, timeoutMs);
    const done = () => {
      window.clearTimeout(timer);
      resolve();
    };
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = done;
    } catch {
      done();
    }
  });
}

export async function clearLocalLibraryData(): Promise<void> {
  if (typeof window === "undefined") return;
  const queue = getUploadQueue();
  for (const task of queue.getSnapshots()) queue.cancelFile(task.clientId);
  queue.clearFinished();
  resetLibrary();
  resetAlbums();
  resetFaces();
  clearThumbUrls();
  clearBlobTextCache();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key && (LOCAL_KEYS.includes(key) || LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage disabled.
  }
  try {
    await closeDb();
    await closeFacesDb();
    if (typeof indexedDB !== "undefined") {
      await deleteDatabase(CACHE_DB_NAME, 1500);
      await deleteDatabase(FACES_DB_NAME, 1500);
    }
  } catch {
    // Best-effort.
  }
  // The worker also drops what it holds in memory; deleting here covers pages it doesn't control.
  postToServiceWorker({ type: PURGE_MESSAGE });
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => USER_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
          .map((name) => caches.delete(name))
      );
    }
  } catch {
    // Best-effort.
  }
}
