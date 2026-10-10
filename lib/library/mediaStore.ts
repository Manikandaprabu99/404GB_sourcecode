// The app-wide media library: the IndexedDB-cached index plus the sinceSha
// sync, kept in module scope so every screen (Photos, an album, the album
// picker) shares one copy that survives client-side navigation. Local edits are
// optimistic: deletes hide items for an undo window before the DELETE is sent,
// favorites flip immediately and revert if the PATCH fails.

import type { MediaIndexEntry } from "@/lib/media";
import { applyMediaDiff, getCachedMediaIndex, getSyncState, setSyncState } from "@/lib/cache";
import { getUploadQueue } from "@/lib/upload/queueSingleton";
import { ApiError, apiJson, chunk, retryWhenBusy, toLibraryError, type LibraryError } from "./api";
import { onBackupProgress, startBackupWatcher } from "./backupStore";
import { sortNewestFirst } from "./dates";
import { clearThumbUrls } from "./thumbUrls";

export interface LibrarySnapshot {
  repoKey: string | null;
  /** Visible items (pending deletes hidden, optimistic edits applied), newest first. */
  items: MediaIndexEntry[];
  /** The IndexedDB cache has been read. */
  hydrated: boolean;
  /** At least one sync with the server succeeded since the page loaded. */
  synced: boolean;
  syncing: boolean;
  error: LibraryError | null;
}

export type DeleteOutcome =
  | { status: "deleted"; ids: string[] }
  | { status: "undone" }
  | { status: "failed"; error: LibraryError; restoredIds: string[] };

export interface PendingDelete {
  undo(): void;
  done: Promise<DeleteOutcome>;
}

export const UNDO_WINDOW_MS = 5000;
// How long a confirmed local edit may disagree with a freshly synced index
// before the server copy wins (covers reads that lag just behind a commit).
const RECONCILE_GRACE_MS = 10_000;
const FOCUS_SYNC_MIN_INTERVAL_MS = 2000;
// The bulk endpoints accept at most 5000 ids; smaller batches keep bodies small.
const BULK_BATCH = 2000;
// keepalive requests share a 64 KB body budget.
const KEEPALIVE_BATCH = 400;

interface MediaListResponse {
  unchanged: boolean;
  sha: string;
  index?: MediaIndexEntry[];
  /** More of the index at the same sha: fetch ?sha=&offset=nextOffset. */
  nextOffset?: number | null;
}

interface FavoriteOverride {
  favorite: boolean;
  token: number;
  confirmedAt: number | null;
}

type Hidden = { kind: "pending" } | { kind: "confirmed"; at: number };

interface ScheduledDelete {
  ids: string[];
  gen: number;
  timer: number;
  resolve: (outcome: DeleteOutcome) => void;
}

const EMPTY_SNAPSHOT: LibrarySnapshot = {
  repoKey: null,
  items: [],
  hydrated: false,
  synced: false,
  syncing: false,
  error: null,
};

let repoKey: string | null = null;
// Bumped on repo switch; async work started for an older generation is dropped.
let generation = 0;
/** Server truth as of the last sync, plus confirmed local edits (mirrors IndexedDB). */
let base: MediaIndexEntry[] = [];
let lastSha: string | null = null;
let hydrated = false;
let synced = false;
let syncing = false;
let error: LibraryError | null = null;
const hidden = new Map<string, Hidden>();
const overrides = new Map<string, FavoriteOverride>();
const scheduledDeletes = new Set<ScheduledDelete>();
let overrideToken = 0;

let snapshot: LibrarySnapshot = EMPTY_SNAPSHOT;
let itemsDirty = true;
const listeners = new Set<() => void>();
const deleteListeners = new Set<(ids: string[]) => void>();

let hydration: Promise<void> = Promise.resolve();
let inflight: Promise<void> | null = null;
let rerunRequested = false;
let lastSyncStartedAt = 0;
let followUpTimer = 0;
let scheduledSyncTimer = 0;
let mutationChain: Promise<unknown> = Promise.resolve();

function emit() {
  let items = snapshot.items;
  if (itemsDirty) {
    items = [];
    for (const entry of base) {
      if (hidden.has(entry.id)) continue;
      const override = overrides.get(entry.id);
      items.push(
        override && override.favorite !== Boolean(entry.favorite)
          ? { ...entry, favorite: override.favorite }
          : entry
      );
    }
    itemsDirty = false;
  }
  snapshot = { repoKey, items, hydrated, synced, syncing, error };
  for (const listener of listeners) listener();
}

export function subscribeLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLibrarySnapshot(): LibrarySnapshot {
  return snapshot;
}

export function getServerLibrarySnapshot(): LibrarySnapshot {
  return EMPTY_SNAPSHOT;
}

/** Called with ids once their delete is confirmed by the server. */
export function onMediaDeleted(listener: (ids: string[]) => void): () => void {
  deleteListeners.add(listener);
  return () => {
    deleteListeners.delete(listener);
  };
}

function clearTimers() {
  window.clearTimeout(followUpTimer);
  window.clearTimeout(scheduledSyncTimer);
  followUpTimer = 0;
  scheduledSyncTimer = 0;
}

/** Points the store at a repo, loading its cached index (no-op if already there). */
export function ensureLibrary(key: string): void {
  if (repoKey === key) return;
  generation += 1;
  // A pending delete must never be sent once the session may point at another repo.
  for (const scheduled of scheduledDeletes) {
    window.clearTimeout(scheduled.timer);
    scheduled.resolve({ status: "undone" });
  }
  scheduledDeletes.clear();
  clearTimers();
  if (repoKey !== null) clearThumbUrls();

  repoKey = key;
  base = [];
  lastSha = null;
  hydrated = false;
  synced = false;
  syncing = false;
  error = null;
  hidden.clear();
  overrides.clear();
  inflight = null;
  rerunRequested = false;
  itemsDirty = true;
  hydration = hydrate(key, generation);
  emit();
}

async function hydrate(key: string, gen: number): Promise<void> {
  const [cached, state] = await Promise.all([getCachedMediaIndex(key), getSyncState(key)]);
  if (gen !== generation) return;
  if (!synced) {
    base = sortNewestFirst(cached);
    lastSha = cached.length > 0 ? (state?.lastKnownSha ?? null) : null;
    itemsDirty = true;
  }
  hydrated = true;
  emit();
}

function sameEntry(a: MediaIndexEntry, b: MediaIndexEntry): boolean {
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const key in ra) if (ra[key] !== rb[key]) return false;
  for (const key in rb) if (!(key in ra) && rb[key] !== undefined) return false;
  return true;
}

function diffEntries(prev: readonly MediaIndexEntry[], next: readonly MediaIndexEntry[]) {
  const prevById = new Map(prev.map((entry) => [entry.id, entry]));
  const nextIds = new Set(next.map((entry) => entry.id));
  const upserts = next.filter((entry) => {
    const old = prevById.get(entry.id);
    return !old || !sameEntry(old, entry);
  });
  const removedIds = prev.filter((entry) => !nextIds.has(entry.id)).map((entry) => entry.id);
  return { upserts, removedIds };
}

/** Drops local edits the server now reflects; true if another sync should follow. */
function reconcile(current: Map<string, MediaIndexEntry>, startedAt: number): boolean {
  let followUp = false;
  for (const [id, override] of overrides) {
    if (override.confirmedAt === null) continue;
    const entry = current.get(id);
    if (
      !entry ||
      Boolean(entry.favorite) === override.favorite ||
      startedAt - override.confirmedAt >= RECONCILE_GRACE_MS
    ) {
      overrides.delete(id);
      itemsDirty = true;
    } else {
      followUp = true;
    }
  }
  for (const [id, state] of hidden) {
    if (state.kind !== "confirmed") continue;
    if (!current.has(id) || startedAt - state.at >= RECONCILE_GRACE_MS) {
      hidden.delete(id);
      itemsDirty = true;
    } else {
      followUp = true;
    }
  }
  return followUp;
}

function scheduleFollowUp() {
  if (followUpTimer) return;
  followUpTimer = window.setTimeout(() => {
    followUpTimer = 0;
    lastSha = null; // force a full index read instead of trusting "unchanged"
    void syncLibrary();
  }, RECONCILE_GRACE_MS / 2);
}

function scheduleSync(delayMs: number) {
  if (scheduledSyncTimer) return;
  scheduledSyncTimer = window.setTimeout(() => {
    scheduledSyncTimer = 0;
    void syncLibrary();
  }, delayMs);
}

async function runSync(gen: number): Promise<void> {
  await hydration;
  if (gen !== generation || !repoKey) return;
  const key = repoKey;
  const startedAt = Date.now();
  lastSyncStartedAt = startedAt;
  syncing = true;
  emit();
  try {
    const sinceSha = lastSha && base.length > 0 ? lastSha : "";
    const data = await apiJson<MediaListResponse>(
      `/api/media?sinceSha=${encodeURIComponent(sinceSha)}`
    );
    if (gen !== generation) return;

    let followUp: boolean;
    if (data.unchanged) {
      followUp = reconcile(new Map(base.map((entry) => [entry.id, entry])), startedAt);
    } else {
      let fresh = data.index ?? [];
      let nextOffset = data.nextOffset ?? null;
      while (nextOffset !== null && data.sha) {
        const page = await apiJson<MediaListResponse>(
          `/api/media?sha=${encodeURIComponent(data.sha)}&offset=${nextOffset}`
        );
        if (gen !== generation) return;
        fresh = fresh.concat(page.index ?? []);
        nextOffset = page.nextOffset ?? null;
      }
      const diff = diffEntries(base, fresh);
      base = sortNewestFirst(fresh);
      itemsDirty = true;
      followUp = reconcile(new Map(fresh.map((entry) => [entry.id, entry])), startedAt);
      if (diff.upserts.length > 0 || diff.removedIds.length > 0) {
        await applyMediaDiff(key, diff.upserts, diff.removedIds);
      }
      if (data.sha) await setSyncState(key, data.sha);
      if (gen !== generation) return;
    }
    lastSha = data.sha || null;
    synced = true;
    error = null;
    if (followUp) scheduleFollowUp();
  } catch (err) {
    if (gen !== generation) return;
    error = toLibraryError(err);
    if (error.kind === "rate-limit" && error.retryAfterSec !== undefined && error.retryAfterSec <= 600) {
      scheduleSync((error.retryAfterSec + 1) * 1000);
    }
  } finally {
    if (gen === generation) {
      syncing = false;
      emit();
    }
  }
}

/** Re-runs the sinceSha sync now; concurrent calls share one request (plus one rerun). */
export function syncLibrary(): Promise<void> {
  if (!repoKey) return Promise.resolve();
  if (inflight) {
    rerunRequested = true;
    return inflight;
  }
  const gen = generation;
  const run: Promise<void> = runSync(gen).finally(() => {
    if (inflight !== run) return;
    inflight = null;
    if (rerunRequested && gen === generation) {
      rerunRequested = false;
      void syncLibrary();
    }
  });
  inflight = run;
  return run;
}

export function requestLibrarySync(options: { delayMs?: number; minIntervalMs?: number } = {}): void {
  if (!repoKey) return;
  const { delayMs = 0, minIntervalMs = 0 } = options;
  if (minIntervalMs > 0 && (inflight || Date.now() - lastSyncStartedAt < minIntervalMs)) return;
  if (delayMs > 0) scheduleSync(delayMs);
  else void syncLibrary();
}

// Library mutations hit the server one at a time, in the order the user made them.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(task, task);
  mutationChain = next.catch(() => undefined);
  return next;
}

function deleteRequest(ids: readonly string[], keepalive = false): Promise<unknown> {
  if (ids.length === 1) {
    return apiJson(`/api/media/${encodeURIComponent(ids[0])}`, { method: "DELETE", keepalive });
  }
  return apiJson("/api/media", { method: "DELETE", body: { ids }, keepalive });
}

function markDeleted(key: string, ids: readonly string[]) {
  const now = Date.now();
  const gone = new Set(ids);
  for (const id of ids) hidden.set(id, { kind: "confirmed", at: now });
  base = base.filter((entry) => !gone.has(entry.id));
  itemsDirty = true;
  emit();
  void applyMediaDiff(key, [], [...ids]);
  for (const listener of deleteListeners) listener([...ids]);
}

function unhidePending(ids: readonly string[]) {
  for (const id of ids) {
    if (hidden.get(id)?.kind === "pending") hidden.delete(id);
  }
  itemsDirty = true;
  emit();
}

async function commitDelete(scheduled: ScheduledDelete): Promise<void> {
  const outcome = await enqueue(async (): Promise<DeleteOutcome> => {
    const { ids, gen } = scheduled;
    if (gen !== generation || !repoKey) return { status: "undone" };
    const key = repoKey;
    const deleted = new Set<string>();
    for (const batch of chunk(ids, BULK_BATCH)) {
      try {
        await retryWhenBusy(() => deleteRequest(batch));
      } catch (err) {
        // A 404 means it's already gone, which is what the user asked for.
        if (!(err instanceof ApiError && err.kind === "not-found")) {
          const restoredIds = ids.filter((id) => !deleted.has(id));
          if (gen === generation) {
            if (deleted.size > 0) markDeleted(key, [...deleted]);
            unhidePending(restoredIds);
          }
          return { status: "failed", error: toLibraryError(err), restoredIds };
        }
      }
      for (const id of batch) deleted.add(id);
    }
    if (gen === generation) markDeleted(key, ids);
    return { status: "deleted", ids };
  });
  scheduled.resolve(outcome);
}

/** Hides `ids` now and deletes them after the undo window unless undone.
 * `onCommitStart` fires when the window closes and undo is no longer possible. */
export function deleteWithUndo(
  ids: readonly string[],
  { delayMs = UNDO_WINDOW_MS, onCommitStart }: { delayMs?: number; onCommitStart?: () => void } = {}
): PendingDelete {
  const unique = Array.from(new Set(ids)).filter((id) => !hidden.has(id));
  if (!repoKey || unique.length === 0) {
    return { undo: () => {}, done: Promise.resolve({ status: "undone" }) };
  }
  for (const id of unique) hidden.set(id, { kind: "pending" });
  itemsDirty = true;
  emit();

  let resolveDone: (outcome: DeleteOutcome) => void = () => {};
  const done = new Promise<DeleteOutcome>((resolve) => {
    resolveDone = resolve;
  });
  const scheduled: ScheduledDelete = { ids: unique, gen: generation, timer: 0, resolve: resolveDone };
  scheduled.timer = window.setTimeout(() => {
    scheduledDeletes.delete(scheduled);
    onCommitStart?.();
    void commitDelete(scheduled);
  }, delayMs);
  scheduledDeletes.add(scheduled);

  return {
    undo() {
      if (!scheduledDeletes.has(scheduled)) return;
      window.clearTimeout(scheduled.timer);
      scheduledDeletes.delete(scheduled);
      unhidePending(unique);
      resolveDone({ status: "undone" });
    },
    done,
  };
}

/** Sends deletes still inside their undo window right away (the page is going away). */
export function flushPendingDeletes(): void {
  for (const scheduled of scheduledDeletes) {
    window.clearTimeout(scheduled.timer);
    for (const batch of chunk(scheduled.ids, KEEPALIVE_BATCH)) {
      void deleteRequest(batch, true).catch(() => {});
    }
    if (repoKey && scheduled.gen === generation) markDeleted(repoKey, scheduled.ids);
    scheduled.resolve({ status: "deleted", ids: scheduled.ids });
  }
  scheduledDeletes.clear();
}

async function favoriteRequest(batch: readonly string[], favorite: boolean): Promise<MediaIndexEntry[]> {
  if (batch.length === 1) {
    const data = await apiJson<{ ok?: boolean; entry?: MediaIndexEntry }>(
      `/api/media/${encodeURIComponent(batch[0])}`,
      { method: "PATCH", body: { favorite } }
    );
    return data.entry ? [data.entry] : [];
  }
  const data = await apiJson<{ ok?: boolean; entries?: MediaIndexEntry[] }>("/api/media", {
    method: "PATCH",
    body: { ids: batch, favorite },
  });
  return data.entries ?? [];
}

function confirmFavorites(
  key: string,
  batch: readonly string[],
  favorite: boolean,
  returned: MediaIndexEntry[],
  token: number
) {
  const returnedById = new Map(returned.map((entry) => [entry.id, entry]));
  const wanted = new Set(batch);
  const updated: MediaIndexEntry[] = [];
  base = base.map((entry) => {
    if (!wanted.has(entry.id)) return entry;
    const next = returnedById.get(entry.id) ?? { ...entry, favorite };
    updated.push(next);
    return next;
  });
  const now = Date.now();
  for (const id of batch) {
    const override = overrides.get(id);
    if (override?.token === token) override.confirmedAt = now;
  }
  itemsDirty = true;
  emit();
  void applyMediaDiff(key, updated, []);
}

/** Optimistically sets `favorite`; reverts what the server refused and rethrows. */
export async function setFavorites(ids: readonly string[], favorite: boolean): Promise<void> {
  const unique = Array.from(new Set(ids));
  if (!repoKey || unique.length === 0) return;
  const gen = generation;
  const key = repoKey;
  const token = ++overrideToken;
  for (const id of unique) overrides.set(id, { favorite, token, confirmedAt: null });
  itemsDirty = true;
  emit();

  const confirmed = new Set<string>();
  try {
    await enqueue(async () => {
      for (const batch of chunk(unique, BULK_BATCH)) {
        const returned = await retryWhenBusy(() => favoriteRequest(batch, favorite));
        if (gen !== generation) return;
        confirmFavorites(key, batch, favorite, returned, token);
        for (const id of batch) confirmed.add(id);
      }
    });
  } catch (err) {
    if (gen === generation) {
      for (const id of unique) {
        if (!confirmed.has(id) && overrides.get(id)?.token === token) overrides.delete(id);
      }
      itemsDirty = true;
      emit();
    }
    throw err;
  }
}

/** Applies a change the server already made (e.g. a backfilled thumbnail) without a full sync. */
export function updateEntryLocally(id: string, patch: Partial<Omit<MediaIndexEntry, "id">>): void {
  if (!repoKey) return;
  const index = base.findIndex((entry) => entry.id === id);
  if (index < 0) return;
  const updated: MediaIndexEntry = { ...base[index], ...patch };
  base = [...base.slice(0, index), updated, ...base.slice(index + 1)];
  itemsDirty = true;
  emit();
  void applyMediaDiff(repoKey, [updated], []);
}

let watchersInstalled = false;

/** Refresh triggers, installed once for the page's lifetime: focus/visibility,
 * reconnect, finished web uploads and the phone's backup progress. */
export function installLibraryWatchers(): void {
  if (watchersInstalled || typeof window === "undefined") return;
  watchersInstalled = true;

  const onFocus = () => requestLibrarySync({ minIntervalMs: FOCUS_SYNC_MIN_INTERVAL_MS });
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onFocus();
  });
  window.addEventListener("online", () => requestLibrarySync());
  window.addEventListener("pagehide", flushPendingDeletes);

  const seenDone = new Set<string>();
  let primed = false;
  getUploadQueue().subscribe((tasks) => {
    let finishedNew = false;
    for (const task of tasks) {
      if (task.status !== "done" || seenDone.has(task.clientId)) continue;
      seenDone.add(task.clientId);
      if (primed) finishedNew = true;
    }
    primed = true;
    if (finishedNew) requestLibrarySync({ delayMs: 1200 });
  });

  startBackupWatcher();
  onBackupProgress((event) => {
    // Throttled while a long backup run streams in; immediate once it ends.
    if (event === "finished") requestLibrarySync();
    else requestLibrarySync({ delayMs: 6000 });
  });
}
