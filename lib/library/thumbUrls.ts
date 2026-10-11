// In-memory cache of thumbnail object URLs that outlives individual tiles, so a
// tile that remounts (scrolling back, switching tabs) paints its image on the
// first frame instead of flashing a skeleton while IndexedDB is read again.
// URLs still referenced by a mounted tile are never revoked; idle ones are
// evicted oldest-first beyond the class's limit (the viewer's 1600px previews
// are big, so far fewer of those stay around).

const MAX_IDLE = 500;
const MAX_IDLE_LARGE = 12;
const LARGE_SIZE = 1600;

interface Entry {
  url: string;
  refs: number;
}

class UrlCache {
  // Map iteration order doubles as the LRU order (re-inserted on every touch).
  private readonly entries = new Map<string, Entry>();
  private idleCount = 0;

  constructor(private readonly maxIdle: number) {}

  peek(key: string): string | null {
    return this.entries.get(key)?.url ?? null;
  }

  private touch(key: string, entry: Entry) {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evict() {
    if (this.idleCount <= this.maxIdle) return;
    for (const [key, entry] of this.entries) {
      if (this.idleCount <= this.maxIdle) break;
      if (entry.refs > 0) continue;
      URL.revokeObjectURL(entry.url);
      this.entries.delete(key);
      this.idleCount -= 1;
    }
  }

  adopt(key: string, url: string): string {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.url !== url) URL.revokeObjectURL(url);
      return existing.url;
    }
    this.entries.set(key, { url, refs: 0 });
    this.idleCount += 1;
    this.evict();
    return url;
  }

  retain(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    if (entry.refs === 0) this.idleCount -= 1;
    entry.refs += 1;
    this.touch(key, entry);
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.refs === 0) return;
    entry.refs -= 1;
    if (entry.refs === 0) {
      this.idleCount += 1;
      this.touch(key, entry);
      this.evict();
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) URL.revokeObjectURL(entry.url);
    this.entries.clear();
    this.idleCount = 0;
  }
}

const small = new UrlCache(MAX_IDLE);
const large = new UrlCache(MAX_IDLE_LARGE);

function cacheFor(key: string): UrlCache {
  return key.endsWith(`::${LARGE_SIZE}`) ? large : small;
}

export function thumbKey(repoKey: string, mediaId: string, size: number): string {
  return `${repoKey}::${mediaId}::${size}`;
}

export function peekThumbUrl(key: string): string | null {
  return cacheFor(key).peek(key);
}

/** Hands ownership of a freshly created object URL to the cache. Returns the
 * URL to render (an already-cached one wins; the duplicate is revoked). */
export function adoptThumbUrl(key: string, url: string): string {
  return cacheFor(key).adopt(key, url);
}

export function retainThumbUrl(key: string): void {
  cacheFor(key).retain(key);
}

export function releaseThumbUrl(key: string): void {
  cacheFor(key).release(key);
}

export function clearThumbUrls(): void {
  small.clear();
  large.clear();
}
