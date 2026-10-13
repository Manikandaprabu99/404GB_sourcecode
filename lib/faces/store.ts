// The app-wide face grouping state for the open library (docs/FACES.md): manifest/faces.json
// as last read or written (cached in IndexedDB so People paint instantly), plus this device's
// operations that aren't committed yet (new scan results, names, merges, corrections). The
// view the UI shows is "faces.json + pending operations"; a commit replays the same operations
// on faces.json at the branch head inside the race-safe transaction, so concurrent writers
// (another device scanning, another tab renaming) merge instead of overwriting each other.

import { commitReader, getHead, runTransaction, type RepoRef } from "@/lib/github";
import { gitBlobSha } from "@/lib/github/blobCache";
import { MEDIA_INDEX_PATH, type MediaIndexEntry } from "@/lib/media/types";
import { retryWhenBusy, toLibraryError, withRepo, type LibraryError } from "@/lib/library/api";
import { onSessionChange } from "@/lib/session";
import { applyOps, FacesState, type FacesOp, type ScannedFace } from "./cluster";
import { faceKey, FACES_PATH, FACE_MODEL, parseFaceKey, parseFacesDoc, serializeFacesDoc } from "./doc";
import * as idb from "./idb";
import type { FaceBox } from "./people";

export interface FaceRef {
  key: string;
  mediaId: string;
  box: FaceBox;
  score: number;
}

export interface FaceGroup {
  id: string;
  name: string | null;
  hidden: boolean;
  /** The user's chosen avatar face, if any. */
  cover: string | null;
  faces: FaceRef[];
}

export interface FacesSnapshot {
  repoKey: string | null;
  /** faces.json is known (from this device's cache or GitHub), so people can be shown. */
  loaded: boolean;
  /** Read from GitHub since the page loaded. */
  synced: boolean;
  /** Bumped whenever the grouping changes. */
  version: number;
  groups: FaceGroup[];
  /** Media items that already have their faces in the file (found here or on another device). */
  scanned: ReadonlySet<string>;
  /** faces.json was made with another model (another app version): it isn't extended here. */
  foreignModel: string | null;
  pendingOps: number;
  saving: boolean;
  error: LibraryError | null;
}

const EMPTY: FacesSnapshot = {
  repoKey: null,
  loaded: false,
  synced: false,
  version: 0,
  groups: [],
  scanned: new Set(),
  foreignModel: null,
  pendingOps: 0,
  saving: false,
  error: null,
};

/** Names, merges and corrections are committed this soon after the last change. */
const USER_FLUSH_DELAY_MS = 1200;
/** Scan results are committed in batches of this many photos… */
const SCAN_BATCH = 150;
/** …or once the oldest uncommitted one is this old. */
const SCAN_MAX_AGE_MS = 8 * 60_000;
const RETRY_MIN_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
const SYNC_MIN_INTERVAL_MS = 60_000;
const EMIT_THROTTLE_MS = 400;
const HIDDEN_FLUSH_BATCH = 25;
const HIDDEN_FLUSH_AGE_MS = 2 * 60_000;
const PENDING_WRITE_DELAY_MS = 1500;

interface Head {
  state: FacesState;
  text: string | null;
  blobSha: string | null;
  commitSha: string | null;
}

let repoKey: string | null = null;
let generation = 0;
let head: Head = { state: FacesState.empty(), text: null, blobSha: null, commitSha: null };
/** Bumped whenever `head` is replaced, so a slow read can't overwrite a newer commit. */
let headVersion = 0;
let pending: FacesOp[] = [];
let local: FacesState = FacesState.empty();
let localChain: Promise<unknown> = Promise.resolve();
let loaded = false;
let synced = false;
let saving = false;
let error: LibraryError | null = null;
let version = 0;
let hydration: Promise<void> = Promise.resolve();

let headEtag: { etag: string; sha: string } | null = null;
let syncInflight: Promise<void> | null = null;
let lastSyncAt = 0;
/** The commit on its way, if any (later flushFaces calls join it). */
let flushInflight: Promise<void> | null = null;
let flushTimer = 0;
let flushDueAt = 0;
let retryDelayMs = RETRY_MIN_MS;
let firstPendingScanAt = 0;
let pendingWriteTimer = 0;

let snapshot: FacesSnapshot = EMPTY;
let emitTimer = 0;
let lastEmitAt = 0;
const listeners = new Set<() => void>();

function computeSnapshot(): FacesSnapshot {
  const groups: FaceGroup[] = local.groups().map((g) => ({
    id: g.id,
    name: g.name,
    hidden: g.hidden,
    cover: g.cover,
    faces: g.faces.map((key) => {
      const face = local.face(key);
      return { key, mediaId: parseFaceKey(key)!.mediaId, box: face!.box, score: face!.score };
    }),
  }));
  return {
    repoKey,
    loaded,
    synced,
    version,
    groups,
    scanned: new Set(local.mediaIds()),
    foreignModel: local.model !== FACE_MODEL ? local.model : null,
    pendingOps: pending.length,
    saving,
    error,
  };
}

function emitNow() {
  window.clearTimeout(emitTimer);
  emitTimer = 0;
  lastEmitAt = Date.now();
  snapshot = computeSnapshot();
  for (const listener of listeners) listener();
}

/** Coalesces bursts (a scan result every few hundred ms) into one recomputation. */
function emit(immediate = false) {
  if (typeof window === "undefined") return;
  if (immediate || Date.now() - lastEmitAt > EMIT_THROTTLE_MS) {
    emitNow();
    return;
  }
  if (!emitTimer) emitTimer = window.setTimeout(emitNow, EMIT_THROTTLE_MS);
}

export function subscribeFaces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFacesSnapshot(): FacesSnapshot {
  return snapshot;
}

export function getServerFacesSnapshot(): FacesSnapshot {
  return EMPTY;
}

/** Runs local-state changes one at a time (a replay yields, an op mustn't land mid-replay). */
function serial<T>(task: () => T | Promise<T>): Promise<T> {
  const next = localChain.then(task, task);
  localChain = next.catch(() => undefined);
  return next;
}

function reset(key: string | null) {
  generation += 1;
  window.clearTimeout(flushTimer);
  window.clearTimeout(pendingWriteTimer);
  flushTimer = 0;
  flushDueAt = 0;
  pendingWriteTimer = 0;
  repoKey = key;
  head = { state: FacesState.empty(), text: null, blobSha: null, commitSha: null };
  headVersion += 1;
  pending = [];
  local = FacesState.empty();
  localChain = Promise.resolve();
  loaded = false;
  synced = false;
  saving = false;
  flushInflight = null;
  error = null;
  version += 1;
  headEtag = null;
  syncInflight = null;
  lastSyncAt = 0;
  retryDelayMs = RETRY_MIN_MS;
  firstPendingScanAt = 0;
}

/** Points the store at a library (no-op if already there): cached state first, then GitHub. */
export function ensureFaces(key: string): void {
  if (typeof window === "undefined" || repoKey === key) return;
  reset(key);
  const gen = generation;
  hydration = hydrate(key, gen);
  installWatchers();
  emit(true);
}

/** Forgets everything in memory (signing out). */
export function resetFaces(): void {
  if (repoKey === null) return;
  reset(null);
  hydration = Promise.resolve();
  emit(true);
}

function isOp(value: unknown): value is FacesOp {
  if (!value || typeof value !== "object") return false;
  const op = (value as { op?: unknown }).op;
  return op === "scan" || op === "name" || op === "hide" || op === "merge" || op === "reject" || op === "cover";
}

async function hydrate(key: string, gen: number): Promise<void> {
  const [stored, ops] = await Promise.all([idb.readDoc(key), idb.readPending(key)]);
  if (gen !== generation) return;
  if (stored) {
    try {
      head = {
        state: FacesState.fromDoc(parseFacesDoc(stored.text)),
        text: stored.text,
        blobSha: stored.blobSha,
        commitSha: stored.commitSha,
      };
      headVersion += 1;
      loaded = true;
    } catch {
      // A cached copy that doesn't parse is just ignored; GitHub has the real one.
    }
  }
  pending = ops.filter(isOp);
  await rebuildLocal(gen);
  if (gen !== generation) return;
  emit(true);
  void syncFaces({ force: true }).then(() => {
    if (gen === generation && pending.length > 0) scheduleFlush(5000);
  });
}

/** local = head + pending, rebuilt off a copy and swapped in at the end. */
function rebuildLocal(gen: number): Promise<void> {
  return serial(async () => {
    if (gen !== generation) return;
    const next = head.state.clone();
    await applyOps(next, pending);
    if (gen !== generation) return;
    local = next;
    version += 1;
  });
}

function persistDoc(key: string) {
  void idb.writeDoc({
    repoKey: key,
    text: head.text,
    blobSha: head.blobSha,
    commitSha: head.commitSha,
    savedAt: Date.now(),
  });
}

function persistPendingSoon(key: string) {
  if (pendingWriteTimer) return;
  pendingWriteTimer = window.setTimeout(() => {
    pendingWriteTimer = 0;
    if (repoKey === key) void idb.writePending(key, pending);
  }, PENDING_WRITE_DELAY_MS);
}

/** A newer faces.json: adopt it and replay what's still pending on top. */
async function adoptHead(gen: number, key: string, next: Head): Promise<void> {
  head = next;
  headVersion += 1;
  // Photos another device already scanned don't need this device's result any more.
  pending = pending.filter((op) => op.op !== "scan" || !next.state.hasMedia(op.media));
  await rebuildLocal(gen);
  if (gen !== generation) return;
  persistDoc(key);
  void idb.writePending(key, pending);
}

/** Re-reads faces.json if the branch moved (a 304 head check costs no rate limit). */
export function syncFaces(options: { force?: boolean } = {}): Promise<void> {
  if (!repoKey) return Promise.resolve();
  if (syncInflight) return syncInflight;
  if (!options.force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) return Promise.resolve();
  const gen = generation;
  const key = repoKey;
  const run = (async () => {
    await hydration;
    if (gen !== generation) return;
    lastSyncAt = Date.now();
    const startedAt = headVersion;
    try {
      const read = await withRepo((repo) => readHead(repo), key);
      if (gen !== generation) return;
      // A commit of ours that landed meanwhile is newer than whatever this read saw.
      if (startedAt === headVersion) {
        if (read.kind === "new") await adoptHead(gen, key, read.head);
        else if (read.kind === "same-file" && head.commitSha !== read.commitSha) {
          head = { ...head, commitSha: read.commitSha };
          persistDoc(key);
        }
      }
      synced = true;
      error = null;
    } catch (err) {
      if (gen !== generation) return;
      error = toLibraryError(err);
    } finally {
      if (gen === generation) {
        loaded = true;
        version += 1;
        emit(true);
      }
    }
  })().finally(() => {
    if (syncInflight === run) syncInflight = null;
  });
  syncInflight = run;
  return run;
}

type HeadRead = { kind: "unchanged" } | { kind: "same-file"; commitSha: string } | { kind: "new"; head: Head };

/** faces.json at the branch head, read only when it differs from what this device has. */
async function readHead(repo: RepoRef): Promise<HeadRead> {
  const check = await getHead(repo, headEtag?.etag);
  let sha: string;
  if (check.modified) {
    sha = check.sha;
    headEtag = check.etag ? { etag: check.etag, sha } : null;
  } else if (headEtag) {
    sha = headEtag.sha;
  } else {
    const fresh = await getHead(repo);
    if (!fresh.modified) throw new Error("GitHub didn't return the branch head");
    sha = fresh.sha;
  }
  if (head.commitSha === sha && loaded) return { kind: "unchanged" };
  const reader = commitReader(repo, sha);
  const blobSha = await reader.fileSha(FACES_PATH);
  if (loaded && blobSha === head.blobSha && (blobSha !== null || head.text === null)) {
    return { kind: "same-file", commitSha: sha };
  }
  const text = blobSha ? await reader.readText(FACES_PATH) : null;
  return { kind: "new", head: { state: FacesState.fromDoc(parseFacesDoc(text)), text, blobSha, commitSha: sha } };
}

function commitMessage(ops: readonly FacesOp[]): string {
  const scans = ops.filter((op) => op.op === "scan").length;
  const edits = ops.length - scans;
  const photos = scans === 1 ? "1 photo" : `${scans} photos`;
  if (edits === 0) return `404gb: faces in ${photos}`;
  if (scans === 0) return "404gb: update people";
  return `404gb: update people, faces in ${photos}`;
}

/** One race-safe commit of `ops` replayed on the head's faces.json. */
async function commitFaces(repo: RepoRef, ops: readonly FacesOp[]): Promise<Head> {
  let built: { state: FacesState; text: string | null } | null = null;
  const result = await runTransaction(repo, async (snap) => {
    const text = await snap.readText(FACES_PATH);
    const state = FacesState.fromDoc(parseFacesDoc(text));
    // Another app version's embeddings can't be mixed with ours: only edits apply then.
    const replay = state.model === FACE_MODEL ? ops : ops.filter((op) => op.op !== "scan");
    await applyOps(state, replay);
    // Faces of items that left the library for good (Trash emptied, deleted) go too.
    try {
      const index = await snap.readJsonArray<MediaIndexEntry>(MEDIA_INDEX_PATH);
      if (index.length > 0) state.forgetMediaExcept(new Set(index.map((entry) => entry.id)));
    } catch {
      // An unreadable index is the library's problem; just don't clean up this time.
    }
    // Nothing to remember and no file yet: don't create one.
    const empty = state.mediaCount === 0 && state.groups().length === 0;
    const nextText = text === null && empty ? null : serializeFacesDoc(state.toDoc());
    built = { state, text: nextText ?? text };
    if (nextText === null || nextText === text) return { result: null };
    return { result: null, commit: { blobs: [{ path: FACES_PATH, text: nextText }], message: commitMessage(replay) } };
  });
  const out = built as { state: FacesState; text: string | null } | null;
  if (!out) throw new Error("faces commit built nothing");
  return {
    state: out.state,
    text: out.text,
    blobSha: out.text === null ? null : await gitBlobSha(out.text),
    commitSha: result.commitSha ?? result.parentSha,
  };
}

function scheduleFlush(delayMs: number) {
  if (!repoKey) return;
  const due = Date.now() + Math.max(0, delayMs);
  if (flushTimer && flushDueAt <= due) return;
  window.clearTimeout(flushTimer);
  flushDueAt = due;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    flushDueAt = 0;
    void flushFaces();
  }, Math.max(0, delayMs));
}

/** Commits everything pending now (also used when the app goes to the background); a commit
 * already on its way is joined instead. */
export function flushFaces(): Promise<void> {
  if (flushInflight) return flushInflight;
  if (!repoKey || pending.length === 0) return Promise.resolve();
  if (error?.code === "corrupt_manifest" || error?.kind === "auth") return Promise.resolve();
  const run = commitPending(repoKey).finally(() => {
    if (flushInflight === run) flushInflight = null;
  });
  flushInflight = run;
  return run;
}

async function commitPending(key: string): Promise<void> {
  const gen = generation;
  const ops = pending.slice();
  saving = true;
  emit(true);
  try {
    await hydration;
    const next = await retryWhenBusy(() => withRepo((repo) => commitFaces(repo, ops), key));
    if (gen !== generation) return;
    const flushed = new Set(ops);
    await serial(async () => {
      if (gen !== generation) return;
      pending = pending.filter((op) => !flushed.has(op));
      head = next;
      headVersion += 1;
      if (headEtag && next.commitSha) headEtag = null;
      const view = next.state.clone();
      await applyOps(view, pending);
      if (gen !== generation) return;
      local = view;
      version += 1;
    });
    if (gen !== generation) return;
    firstPendingScanAt = pending.some((op) => op.op === "scan") ? Date.now() : 0;
    persistDoc(key);
    void idb.writePending(key, pending);
    error = null;
    retryDelayMs = RETRY_MIN_MS;
  } catch (err) {
    if (gen !== generation) return;
    error = toLibraryError(err);
    if (error.kind === "auth" || error.code === "corrupt_manifest") return;
    const wait = error.kind === "rate-limit" && error.retryAfterSec ? (error.retryAfterSec + 1) * 1000 : retryDelayMs;
    retryDelayMs = Math.min(RETRY_MAX_MS, retryDelayMs * 2);
    scheduleFlush(wait);
  } finally {
    if (gen === generation) {
      saving = false;
      emit(true);
      if (pending.length > 0 && !flushTimer && !error) scheduleNextFlush();
    }
  }
}

const FINAL_COMMIT_ATTEMPTS = 3;

/**
 * Commits everything pending and waits for it, trying a failed commit again a couple of times
 * (the background runner, before it says it's finished). Resolves with what kept the commit
 * from landing, or null when nothing is left pending.
 */
export async function commitPendingFaces(): Promise<LibraryError | null> {
  for (let attempt = 1; ; attempt++) {
    if (!repoKey) return null;
    await flushFaces();
    if (pending.length === 0) return null;
    // Waiting wouldn't help with these; the operations stay on this device for next time.
    if (error && (error.kind === "auth" || error.kind === "rate-limit" || error.code === "corrupt_manifest")) return error;
    if (attempt >= FINAL_COMMIT_ATTEMPTS) return error ?? { kind: "server", message: "Not everything could be saved" };
    if (error) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
}

/** Writes the pending operations to this device right away (the page is about to go). */
export function savePendingFaces(): Promise<void> {
  window.clearTimeout(pendingWriteTimer);
  pendingWriteTimer = 0;
  return repoKey ? idb.writePending(repoKey, pending) : Promise.resolve();
}

function pendingCounts(): { edits: number; scans: number } {
  const edits = pending.filter((op) => op.op !== "scan").length;
  return { edits, scans: pending.length - edits };
}

function scheduleNextFlush() {
  const { edits, scans } = pendingCounts();
  if (edits > 0) scheduleFlush(USER_FLUSH_DELAY_MS);
  else if (scans >= SCAN_BATCH) scheduleFlush(0);
  else if (scans > 0) scheduleFlush(Math.max(0, (firstPendingScanAt || Date.now()) + SCAN_MAX_AGE_MS - Date.now()));
}

function addOp(op: FacesOp): Promise<void> {
  const key = repoKey;
  const gen = generation;
  if (!key) return Promise.resolve();
  return serial(() => {
    if (gen !== generation) return;
    if (!local.apply(op)) return;
    pending.push(op);
    if (op.op === "scan" && !firstPendingScanAt) firstPendingScanAt = Date.now();
    version += 1;
    persistPendingSoon(key);
    emit(op.op !== "scan");
    scheduleNextFlush();
  });
}

/** A media item's faces as found on this device (an empty list counts: "no faces here"). */
export function addScanResult(mediaId: string, faces: ScannedFace[]): Promise<void> {
  if (local.hasMedia(mediaId)) return Promise.resolve();
  return addOp({ op: "scan", media: mediaId, faces });
}

/** Commits soon (the scan just finished, or the user is about to leave). */
export function flushFacesSoon(delayMs = 3000): void {
  if (pending.length > 0) scheduleFlush(delayMs);
}

export function hasFaces(mediaId: string): boolean {
  return local.hasMedia(mediaId);
}

/** The person an id resolves to after merges (itself when not merged). */
export function resolvePerson(id: string): string {
  return local.root(id);
}

/** Distance between two people's average faces (smaller = more alike). */
export function personDistance(a: string, b: string): number {
  return local.distanceBetween(a, b);
}

export function renamePerson(personId: string, name: string | null): Promise<void> {
  return addOp({ op: "name", person: personId, name });
}

export function setPersonHidden(personId: string, hidden: boolean): Promise<void> {
  return addOp({ op: "hide", person: personId, hidden });
}

/** `people` become `into` (who keeps their id, name and avatar; a name is never lost). */
export function mergePeople(people: readonly string[], into: string): Promise<void> {
  const ids = people.filter((id) => local.root(id) !== local.root(into));
  if (ids.length === 0) return Promise.resolve();
  return addOp({ op: "merge", people: [...ids], into });
}

function facesOf(personId: string, mediaIds: readonly string[]): string[] {
  const root = local.root(personId);
  const keys: string[] = [];
  for (const mediaId of mediaIds) {
    local.facesIn(mediaId).forEach((_, index) => {
      const key = faceKey(mediaId, index);
      if (local.personOfFace(key) === root) keys.push(key);
    });
  }
  return keys;
}

/** "Not this person" for every face of `personId` in these photos; remembered for good. */
export function removeFromPerson(personId: string, mediaIds: readonly string[]): Promise<void> {
  const faces = facesOf(personId, mediaIds);
  if (faces.length === 0) return Promise.resolve();
  return addOp({ op: "reject", person: personId, faces });
}

/** Uses the person's face in `mediaId` as their avatar. */
export function setPersonCover(personId: string, mediaId: string): Promise<void> {
  const [face] = facesOf(personId, [mediaId]);
  if (!face) return Promise.resolve();
  return addOp({ op: "cover", person: personId, face });
}

let watchersInstalled = false;

function installWatchers() {
  if (watchersInstalled || typeof window === "undefined") return;
  watchersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Best-effort: what doesn't make it is still pending in IndexedDB for next time. Scan
      // results alone wait for a decent batch, so app switching doesn't mean tiny commits.
      if (repoKey) void idb.writePending(repoKey, pending);
      const { edits, scans } = pendingCounts();
      const stale = firstPendingScanAt > 0 && Date.now() - firstPendingScanAt > HIDDEN_FLUSH_AGE_MS;
      if (edits > 0 || scans >= HIDDEN_FLUSH_BATCH || (scans > 0 && stale)) void flushFaces();
    } else {
      void syncFaces();
    }
  });
  window.addEventListener("online", () => {
    if (pending.length > 0 && error?.kind === "offline") scheduleFlush(2000);
  });
  // A new sign-in must not be judged by the previous one's "signed out".
  onSessionChange(() => {
    if (error?.kind !== "auth") return;
    error = null;
    emit(true);
  });
}
