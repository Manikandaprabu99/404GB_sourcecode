// Removes the signed-in user's library from this device on log out: the
// IndexedDB index/thumbnail cache, the cached album lists and the service
// worker's thumbnail cache. Best-effort; never throws.

import { CACHE_DB_NAME, getDb } from "@/lib/cache/db";
import { clearThumbUrls } from "./thumbUrls";

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
  clearThumbUrls();
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i);
      if (key?.startsWith("404gb-albums:")) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage disabled.
  }
  try {
    const db = await getDb();
    db?.close();
    if (typeof indexedDB !== "undefined") await deleteDatabase(CACHE_DB_NAME, 1500);
  } catch {
    // Best-effort.
  }
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("404gb-thumbs")).map((name) => caches.delete(name)));
    }
  } catch {
    // Best-effort.
  }
}
