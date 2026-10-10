// In-memory cache of thumbnail object URLs that outlives individual tiles, so a
// tile that remounts (scrolling back, switching tabs) paints its image on the
// first frame instead of flashing a skeleton while IndexedDB is read again.
// URLs still referenced by a mounted tile are never revoked; idle ones are
// evicted oldest-first beyond MAX_IDLE.

const MAX_IDLE = 500;

interface Entry {
  url: string;
  refs: number;
}

// Map iteration order doubles as the LRU order (re-inserted on every touch).
const entries = new Map<string, Entry>();
let idleCount = 0;

export function thumbKey(repoKey: string, mediaId: string, size: number): string {
  return `${repoKey}::${mediaId}::${size}`;
}

export function peekThumbUrl(key: string): string | null {
  return entries.get(key)?.url ?? null;
}

function touch(key: string, entry: Entry) {
  entries.delete(key);
  entries.set(key, entry);
}

function evict() {
  if (idleCount <= MAX_IDLE) return;
  for (const [key, entry] of entries) {
    if (idleCount <= MAX_IDLE) break;
    if (entry.refs > 0) continue;
    URL.revokeObjectURL(entry.url);
    entries.delete(key);
    idleCount -= 1;
  }
}

/** Hands ownership of a freshly created object URL to the cache. Returns the
 * URL to render (an already-cached one wins; the duplicate is revoked). */
export function adoptThumbUrl(key: string, url: string): string {
  const existing = entries.get(key);
  if (existing) {
    if (existing.url !== url) URL.revokeObjectURL(url);
    return existing.url;
  }
  entries.set(key, { url, refs: 0 });
  idleCount += 1;
  evict();
  return url;
}

export function retainThumbUrl(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  if (entry.refs === 0) idleCount -= 1;
  entry.refs += 1;
  touch(key, entry);
}

export function releaseThumbUrl(key: string): void {
  const entry = entries.get(key);
  if (!entry || entry.refs === 0) return;
  entry.refs -= 1;
  if (entry.refs === 0) {
    idleCount += 1;
    touch(key, entry);
    evict();
  }
}

export function clearThumbUrls(): void {
  for (const entry of entries.values()) URL.revokeObjectURL(entry.url);
  entries.clear();
  idleCount = 0;
}
