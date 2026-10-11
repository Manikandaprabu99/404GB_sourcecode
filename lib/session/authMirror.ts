// Copy of the session for the service worker (public/sw.js), which streams videos straight
// from GitHub and can read neither localStorage nor the native plugin: database
// "404gb-auth", store "auth", key "current" (docs/STANDALONE.md). Best-effort.

export const AUTH_DB_NAME = "404gb-auth";
const AUTH_STORE = "auth";
const AUTH_KEY = "current";

export interface MirroredAuth {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

function openAuthDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(AUTH_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(AUTH_STORE)) request.result.createObjectStore(AUTH_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function write(change: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openAuthDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(AUTH_STORE, "readwrite");
      change(tx.objectStore(AUTH_STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Mirrors a complete session; anything less clears the copy. */
export function mirrorAuth(auth: MirroredAuth | null): Promise<void> {
  return write((store) => {
    if (auth) store.put({ token: auth.token, owner: auth.owner, repo: auth.repo, branch: auth.branch }, AUTH_KEY);
    else store.delete(AUTH_KEY);
  });
}
