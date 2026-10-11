// The app-wide media library: the IndexedDB-cached index plus the head-sha sync against
// GitHub, kept in module scope so every screen (Photos, an album, the album picker) shares
// one copy that survives client-side navigation. Local edits are optimistic: deletes hide
// items for an undo window before the commit, favorites flip immediately and revert if the
// commit fails. This page's own commits (and the phone's uploads, reported by the backup
// plugin) are applied directly instead of re-downloading the index.

import { App } from "@capacitor/app";
import { Semaphore } from "@/lib/concurrency";
import {
  backfillThumbnailIfMissing,
  canMakeThumbnails,
  deleteMedia,
  isMediaId,
  setFavorite,
  syncMediaIndex,
  type CommitInfo,
  type CommitUploadResult,
  type MediaIndexEntry,
} from "@/lib/media";
import { applyMediaDiff, getCachedMediaIndex, getSyncState, setSyncState } from "@/lib/cache";
import { Backup } from "@/lib/native/backup";
import { hasNativePlugin } from "@/lib/native/platform";
import { onSessionChange } from "@/lib/session";
import { getUploadQueue } from "@/lib/upload/queueSingleton";
import { ApiError, chunk, retryWhenBusy, toLibraryError, withRepo, type LibraryError } from "./api";
import { onBackupProgress, startBackupWatcher } from "./backupStore";
import { sortNewestFirst } from "./dates";
import { clearThumbUrls } from "./thumbUrls";

export interface LibrarySnapshot {
  repoKey: string | null;
  /** Visible items (pending deletes hidden, optimistic edits applied), newest first. */
  items: MediaIndexEntry[];
  /** The IndexedDB cache has been read. */
  hydrated: boolean;
  /** At least one sync with GitHub succeeded since the page loaded. */
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
// before the repo's copy wins (covers reads that lag just behind a commit).
const RECONCILE_GRACE_MS = 10_000;
const FOCUS_SYNC_MIN_INTERVAL_MS = 2000;
const CATCH_UP_SYNC_DELAY_MS = 1200;
// While the phone's backup runs, its uploads arrive through itemsUploaded; a full index
// read is only a safety net, at most this often.
const BACKUP_SYNC_INTERVAL_MS = 3 * 60_000;
// One commit per batch; keeps each tree and index rewrite a reasonable size.
const BULK_BATCH = 2000;
// Deletes that were due (or in flight) when the page went away, finished on the next start.
const OUTBOX_KEY = "404gb-pending-deletes";

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
/** The repo's index as of the last sync, plus confirmed local edits (mirrors IndexedDB). */
let base: MediaIndexEntry[] = [];
let lastSha: string | null = null;
let hydrated = false;
let synced = false;
let syncing = false;
let error: LibraryError | null = null;
const hidden = new Map<string, Hidden>();
const overrides = new Map<string, FavoriteOverride>();
/** Entries added without a sync (phone backup, this page's uploads), by when they were applied. */
const recentUploads = new Map<string, { entry: MediaIndexEntry; at: number }>();
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

/** Called with ids once their delete is committed. */
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

function resetState(key: string | null) {
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
  recentUploads.clear();
  inflight = null;
  rerunRequested = false;
  // The new library's first sync must not be debounced against the previous library's.
  lastSyncStartedAt = 0;
  itemsDirty = true;
}

/** Points the store at a repo, loading its cached index (no-op if already there). */
export function ensureLibrary(key: string): void {
  if (repoKey === key) return;
  resetState(key);
  hydration = hydrate(key, generation);
  emit();
}

/** Forgets the library in memory (signing out); the next ensureLibrary starts fresh. */
export function resetLibrary(): void {
  if (repoKey === null) return;
  resetState(null);
  hydration = Promise.resolve();
  emit();
}

function withRecentUploads(entries: MediaIndexEntry[]): MediaIndexEntry[] {
  if (recentUploads.size === 0) return entries;
  const present = new Set(entries.map((entry) => entry.id));
  const missing = Array.from(recentUploads.values())
    .filter(({ entry }) => !present.has(entry.id))
    .map(({ entry }) => entry);
  return missing.length > 0 ? [...entries, ...missing] : entries;
}

async function hydrate(key: string, gen: number): Promise<void> {
  const [cached, state] = await Promise.all([getCachedMediaIndex(key), getSyncState(key)]);
  if (gen !== generation) return;
  if (!synced) {
    base = sortNewestFirst(withRecentUploads(cached));
    lastSha = cached.length > 0 ? (state?.lastKnownSha ?? null) : null;
    itemsDirty = true;
  }
  hydrated = true;
  emit();
  resumeOutbox(key, gen);
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

/** Drops local edits the repo now reflects; true if another sync should follow. */
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
    const sinceSha = lastSha && base.length > 0 ? lastSha : undefined;
    const data = await withRepo((repo) => syncMediaIndex(repo, sinceSha), key);
    if (gen !== generation) return;

    let followUp: boolean;
    // Uploads applied before this sync read the head are in (or deliberately gone from) its index.
    const lateUploads = new Map<string, MediaIndexEntry>();
    for (const [id, upload] of recentUploads) {
      if (upload.at > startedAt) lateUploads.set(id, upload.entry);
      else recentUploads.delete(id);
    }
    if (data.unchanged) {
      followUp = reconcile(new Map(base.map((entry) => [entry.id, entry])), startedAt);
    } else {
      const fresh = data.index ?? [];
      const freshIds = new Set(fresh.map((entry) => entry.id));
      const merged = [...fresh, ...Array.from(lateUploads.values()).filter((entry) => !freshIds.has(entry.id))];
      const diff = diffEntries(base, merged);
      base = sortNewestFirst(merged);
      itemsDirty = true;
      followUp = reconcile(new Map(fresh.map((entry) => [entry.id, entry])), startedAt);
      if (diff.upserts.length > 0 || diff.removedIds.length > 0) {
        await applyMediaDiff(key, diff.upserts, diff.removedIds);
      }
      await setSyncState(key, data.sha);
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

/** Re-runs the head-sha sync now; concurrent calls share one run (plus one rerun). */
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

/** This page's own commit: when it was built on the commit the store last synced, the store
 * already shows its result, so the next sync can trust "unchanged" for it. Built on a newer
 * head means someone else committed meanwhile, so catch up shortly. */
function adoptCommit(gen: number, key: string, info: CommitInfo | null | undefined): boolean {
  if (!info?.commitSha || gen !== generation || repoKey !== key) return false;
  if (!lastSha || info.parentSha !== lastSha) {
    requestLibrarySync({ delayMs: CATCH_UP_SYNC_DELAY_MS });
    return false;
  }
  lastSha = info.commitSha;
  void setSyncState(key, info.commitSha);
  return true;
}

// Library mutations hit GitHub one at a time, in the order the user made them.
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = mutationChain.then(task, task);
  mutationChain = next.catch(() => undefined);
  return next;
}

function readOutbox(): Record<string, string[]> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function updateOutbox(key: string, change: (ids: Set<string>) => void): void {
  try {
    const all = readOutbox();
    const ids = new Set((all[key] ?? []).filter(isMediaId));
    change(ids);
    if (ids.size > 0) all[key] = Array.from(ids);
    else delete all[key];
    if (Object.keys(all).length > 0) window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(all));
    else window.localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Storage disabled: a delete interrupted by closing the app is simply not finished.
  }
}

/** Finishes deletes an earlier visit committed to but couldn't complete. */
function resumeOutbox(key: string, gen: number): void {
  const ids = (readOutbox()[key] ?? []).filter(isMediaId);
  if (ids.length === 0 || gen !== generation) return;
  for (const id of ids) hidden.set(id, { kind: "pending" });
  itemsDirty = true;
  emit();
  void commitDelete({ ids, gen, timer: 0, resolve: () => {} });
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
  const { ids, gen } = scheduled;
  const key = repoKey;
  if (gen !== generation || !key) {
    scheduled.resolve({ status: "undone" });
    return;
  }
  updateOutbox(key, (outbox) => ids.forEach((id) => outbox.add(id)));
  const outcome = await enqueue(async (): Promise<DeleteOutcome> => {
    if (gen !== generation || repoKey !== key) return { status: "undone" };
    const deleted = new Set<string>();
    for (const batch of chunk(ids, BULK_BATCH)) {
      try {
        const result = await retryWhenBusy(() => withRepo((repo) => deleteMedia(repo, batch), key));
        adoptCommit(gen, key, result);
      } catch (err) {
        const restoredIds = ids.filter((id) => !deleted.has(id));
        updateOutbox(key, (outbox) => ids.forEach((id) => outbox.delete(id)));
        if (gen === generation) {
          if (deleted.size > 0) markDeleted(key, [...deleted]);
          unhidePending(restoredIds);
        }
        return { status: "failed", error: toLibraryError(err), restoredIds };
      }
      // Ids the repo no longer had are gone too, which is what the user asked for.
      for (const id of batch) deleted.add(id);
    }
    updateOutbox(key, (outbox) => ids.forEach((id) => outbox.delete(id)));
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

/** Commits deletes still inside their undo window right away (the page is going away, or the
 * user signs out). They are noted first, so a page that dies mid-commit finishes them next time. */
export function flushPendingDeletes(): Promise<void> {
  const flushing: Promise<void>[] = [];
  for (const scheduled of scheduledDeletes) {
    window.clearTimeout(scheduled.timer);
    flushing.push(commitDelete(scheduled));
  }
  scheduledDeletes.clear();
  return Promise.all([...flushing, mutationChain]).then(() => undefined);
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

/** Optimistically sets `favorite`; reverts what the commit couldn't change and rethrows. */
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
        const result = await retryWhenBusy(() => withRepo((repo) => setFavorite(repo, batch, favorite), key));
        if (gen !== generation) return;
        confirmFavorites(key, batch, favorite, result?.entries ?? [], token);
        adoptCommit(gen, key, result);
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

/** Applies a change already in the repo (e.g. a backfilled thumbnail) without a full sync. */
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

function isIndexEntry(value: unknown): value is MediaIndexEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MediaIndexEntry>;
  return (
    isMediaId(entry.id) &&
    typeof entry.filename === "string" &&
    typeof entry.hash === "string" &&
    typeof entry.mimeType === "string" &&
    typeof entry.createdAt === "string"
  );
}

/** Shows entries that were just committed (the phone's backup, this page's uploads) at once. */
export function applyUploadedEntries(entries: readonly unknown[]): void {
  if (!repoKey || !Array.isArray(entries)) return;
  const fresh = new Map<string, MediaIndexEntry>();
  for (const entry of entries) if (isIndexEntry(entry)) fresh.set(entry.id, entry);
  if (fresh.size === 0) return;
  const now = Date.now();
  for (const entry of fresh.values()) recentUploads.set(entry.id, { entry, at: now });
  base = sortNewestFirst([...base.filter((entry) => !fresh.has(entry.id)), ...fresh.values()]);
  itemsDirty = true;
  emit();
  void applyMediaDiff(repoKey, Array.from(fresh.values()), []);
}

/** A web upload that just committed into `result.repoKey` ("owner/repo"). */
function applyCommittedUpload(result: CommitUploadResult & { repoKey: string }): void {
  if (!repoKey || result.repoKey !== repoKey || result.duplicate) return;
  const gen = generation;
  const key = repoKey;
  applyUploadedEntries([result.entry]);
  adoptCommit(gen, key, result);
}

const backfillSlots = new Semaphore(1);
let backfillPausedUntil = 0;

/** Makes thumbnails in this browser for an image stored without any (one at a time); the new 320px path, or null. */
export async function backfillThumbnail(mediaId: string): Promise<string | null> {
  if (!repoKey) return null;
  const entry = base.find((item) => item.id === mediaId);
  if (entry && (!canMakeThumbnails(entry.mimeType) || entry.thumb)) return null;
  const key = repoKey;
  const gen = generation;
  const release = await backfillSlots.acquire();
  try {
    if (gen !== generation || Date.now() < backfillPausedUntil) return null;
    const result = await withRepo((repo) => backfillThumbnailIfMissing(repo, mediaId), key);
    const thumb = result.thumbnails?.["320"];
    if (!thumb || gen !== generation) return null;
    updateEntryLocally(mediaId, { thumb });
    adoptCommit(gen, key, result.commit);
    return thumb;
  } catch (err) {
    if (err instanceof ApiError && err.kind === "rate-limit") {
      backfillPausedUntil = Date.now() + (err.retryAfterSec ?? 60) * 1000;
    }
    return null;
  } finally {
    release();
  }
}

// A sign-in (or repo choice) made after a failure must not be judged by that failure: the
// screens would otherwise treat the stale "signed out" error as being about the new token.
onSessionChange(() => {
  if (error?.kind !== "auth") return;
  error = null;
  emit();
});

let watchersInstalled = false;

/** Refresh triggers, installed once for the page's lifetime: focus/visibility and app resume,
 * reconnect, finished web uploads and the phone's backup. */
export function installLibraryWatchers(): void {
  if (watchersInstalled || typeof window === "undefined") return;
  watchersInstalled = true;

  const onFocus = () => requestLibrarySync({ minIntervalMs: FOCUS_SYNC_MIN_INTERVAL_MS });
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") onFocus();
  });
  window.addEventListener("online", () => requestLibrarySync());
  window.addEventListener("pagehide", () => void flushPendingDeletes());

  getUploadQueue().onCommitted(applyCommittedUpload);

  startBackupWatcher();
  if (hasNativePlugin("Backup")) {
    App.addListener("resume", onFocus).catch(() => {});
    Backup.addListener("itemsUploaded", (event) => applyUploadedEntries(event?.entries ?? [])).catch(() => {});
  }
  onBackupProgress((event) => {
    if (event === "finished") {
      requestLibrarySync();
      return;
    }
    requestLibrarySync({ delayMs: Math.max(1, lastSyncStartedAt + BACKUP_SYNC_INTERVAL_MS - Date.now()) });
  });
}
