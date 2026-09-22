// Small, generic bounded-concurrency helpers (Phase 4 — Performance).
//
// Used in two places:
//  - server-side: lib/media/reconstructMedia fetches a media file's chunks
//    in parallel (capped) instead of one-at-a-time.
//  - client-side: lib/cache/thumbnailLoader caps how many thumbnail fetches
//    a scrolling gallery can have in flight at once.
//
// Pure Promise/timer code, no Node- or DOM-specific APIs, so the same module
// works in an API route and in a browser component.
//
// Note: lib/upload/uploadQueue.ts has its own `runWithConcurrency` — kept
// separate on purpose, since it also needs pause/cancel awareness specific
// to the upload flow. This module is for the simpler "just cap concurrency"
// cases.

/** A counting semaphore: `await acquire()` blocks until a slot is free, and
 * resolves to a release function the caller must call exactly once. */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, limit);
  }

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.available -= 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.available += 1;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.available > 0) grant();
      else this.queue.push(grant);
    });
  }
}

/**
 * Runs `fn` over `items` with at most `limit` calls in flight at once.
 * Results are returned in the same order as `items` regardless of which
 * call finishes first. Throws (and stops launching new work) as soon as any
 * call rejects.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, () => runNext());
  await Promise.all(workers);
  return results;
}
