// Finds faces in the library a little at a time (docs/FACES.md "What gets scanned, and when").
// runBackgroundScan is the same loop for the phone's headless runner page (docs/FACES.md "Background").

import { getDb } from "@/lib/cache/db";
import { getCachedThumbnail } from "@/lib/cache/thumbnailCache";
import { getContentBinary } from "@/lib/github";
import { ApiError, withRepo, type LibraryError } from "@/lib/library/api";
import { startBackupWatcher, subscribeBackup } from "@/lib/library/backupStore";
import { getLibrarySnapshot, subscribeLibrary } from "@/lib/library/mediaStore";
import { getWebUploadProgress, subscribeWebUploads } from "@/lib/library/uploadProgress";
import { thumbnailPath, type MediaIndexEntry } from "@/lib/media/types";
import { getBackgroundFaceScan, refreshBackgroundFaceScan, subscribeBackgroundFaceScan } from "./background";
import type { ScannedFace } from "./cluster";
import { FACE_MODEL, normalizeBox, quantizeEmbedding } from "./doc";
import {
  createFaceEngine,
  FaceDecodeError,
  FaceEngineUnavailableError,
  type FaceEngine,
  type FaceEngineOptions,
} from "./engine";
import * as idb from "./idb";
import { getScanStatus, onScanCommand, setScanStatus, type ScanReason, type ScanState } from "./scanStatus";
import {
  addScanResult,
  commitPendingFaces,
  ensureFaces,
  flushFacesSoon,
  getFacesSnapshot,
  hasFaces,
  savePendingFaces,
  subscribeFaces,
  syncFaces,
} from "./store";
import { createWorkerTimers, windowTimers, yieldToPage, type Timers } from "./timers";

/** Thumbnails fetched from GitHub for scanning, per hour (GitHub allows 5,000 calls/hour in all). */
export const NETWORK_BUDGET_PER_HOUR = 600;
const NETWORK_BURST_PER_MINUTE = 30;
/** Rest between photos at least this long, and at least as long as the last one took. */
const MIN_GAP_MS = 250;
/** Wait this long after the user last touched, wheeled or typed before running the model again. */
const QUIET_AFTER_INPUT_MS = 1200;
const OTHER_TAB_RETRY_MS = 30_000;
const ENGINE_IDLE_DISPOSE_MS = 60_000;
const CACHED_KEYS_REFRESH_MS = 3 * 60_000;
const MAX_CONSECUTIVE_ERRORS = 3;
const BUDGET_KEY_PREFIX = "404gb-faces:budget:";
/** How long asking the phone about its background run may hold the scan up. */
const BACKGROUND_CHECK_MAX_MS = 3000;
/** A background run that ended this recently may have committed after this page read faces.json. */
const RECENT_BACKGROUND_RUN_MS = 5 * 60_000;

// Background runs (runBackgroundScan).
/** Scanning stops this long before the deadline (or halfway, for a short run) to commit in time. */
const COMMIT_MARGIN_MS = 30_000;
/** The final commit gets this long: the host closes the page 30 s after asking it to stop. */
const FINAL_COMMIT_MS = 24_000;
/** After a stop, the photo in hand gets this long before the commit goes ahead without it. */
const STOP_GRACE_MS = 2000;
const BACKGROUND_DETECT_TIMEOUT_MS = 45_000;
/** A never-drawn WebView may never run WebGL's frame callbacks: background runs skip it. */
const BACKGROUND_BACKENDS = ["wasm", "cpu"];
/** Progress goes to the host every few photos, and every few seconds while photos come in. */
const PROGRESS_EVERY = 5;
const PROGRESS_INTERVAL_MS = 3000;
const DEFAULT_RUN_MS = 9 * 60_000;

/** Why a background run ended early, as the app shows it (Settings › People; ≤ 300 characters). */
const ENDED = {
  signedOut: "Your GitHub sign-in ended. Open 404GB to sign in again.",
  otherModel: "People were found by a newer version of 404GB. Update the app to go on.",
  rateLimit: "GitHub asked 404GB to slow down. It goes on next time.",
  otherRun: "Another People run was already going.",
  saveTimeout: "Saving the people found took too long. They're saved next time.",
};

/** A background run's limits and bookkeeping (runBackgroundScan). */
interface Background {
  budgetPerHour: number;
  burstPerMinute: number;
  /** Scanning stops then, so the commit lands before the host's deadline. */
  stopAt: number;
  localThumbnails: boolean;
  /** Photos /_local/thumb/ had no copy of. */
  notLocal: Set<string>;
  checked: number;
  /** When a used-up download budget frees up, if that ended the run. */
  resumeAt: number | null;
  reported: { checked: number; at: number };
  onProgress(checked: number, total: number): void;
  /** Why the run ends; the first reason sticks. */
  reason: string | null;
  onEnd(): void;
  /** Detector results still being written to IndexedDB. */
  writes: Set<Promise<void>>;
}

interface Run {
  repoKey: string;
  stopped: boolean;
  /** Set on the background runner page; null in the app. */
  background: Background | null;
}

let current: Run | null = null;
let engine: FaceEngine | null = null;
let engineError: string | null = null;
let engineDisposeTimer = 0;
let lastInputAt = 0;
let wakeUp: (() => void) | null = null;
let rateLimitedUntil = 0;
let inputListenersInstalled = false;
/** The page's own timers, or a worker's during a background run (they aren't throttled). */
let timers: Timers = windowTimers;

// The phone's background run as seen from the app (./background).
let backgroundCheck = 0;
let backgroundChecking = false;
let backgroundSettling = false;
let backgroundSeen: { running: boolean; lastRunAt: number | null } | null = null;

const failed = new Set<string>();
let scans = new Map<string, idb.StoredScan>();
let cachedThumbs: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = timers.set(done, ms);
    function done() {
      timers.clear(timer);
      if (wakeUp === done) wakeUp = null;
      resolve();
    }
    wakeUp = done;
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.set(() => resolve(), ms);
  });
}

function wake() {
  wakeUp?.();
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout: 2000 });
    else window.setTimeout(resolve, 50);
  });
}

function installInputListeners() {
  if (inputListenersInstalled) return;
  inputListenersInstalled = true;
  const mark = () => {
    lastInputAt = Date.now();
  };
  const opts = { capture: true, passive: true } as const;
  // Only what the user does: programmatic scrolls (a carousel, scroll restoration) never hold it up.
  for (const type of ["pointerdown", "touchmove", "wheel", "keydown"]) window.addEventListener(type, mark, opts);
}

/** Images the scanner can read: a stored (always WebP) thumbnail, not a video, not in Trash. */
export function isScannable(item: MediaIndexEntry): boolean {
  return item.mimeType.startsWith("image/") && Boolean(item.thumb) && !item.trashedAt;
}

// --- network budget --------------------------------------------------------------------------

function readBudget(repoKey: string): number[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(BUDGET_KEY_PREFIX + repoKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is number => typeof t === "number") : [];
  } catch {
    return [];
  }
}

/** Takes one network fetch from the hourly budget (shared by this repo's tabs), or says when to retry. */
function takeBudget(run: Run): { ok: true } | { ok: false; until: number } {
  const perHour = run.background?.budgetPerHour ?? NETWORK_BUDGET_PER_HOUR;
  const perMinute = run.background?.burstPerMinute ?? NETWORK_BURST_PER_MINUTE;
  const now = Date.now();
  if (perHour <= 0) return { ok: false, until: now + 3600_000 };
  const recent = readBudget(run.repoKey).filter((t) => t > now - 3600_000 && t <= now);
  if (recent.length >= perHour) return { ok: false, until: Math.min(...recent) + 3600_000 };
  const lastMinute = recent.filter((t) => t > now - 60_000);
  if (lastMinute.length >= perMinute) return { ok: false, until: Math.min(...lastMinute) + 60_000 };
  recent.push(now);
  try {
    window.localStorage.setItem(BUDGET_KEY_PREFIX + run.repoKey, JSON.stringify(recent));
  } catch {
    // Storage disabled: the in-page pacing still applies.
  }
  return { ok: true };
}

// --- thumbnails ------------------------------------------------------------------------------

/** Media ids with a thumbnail in this device's cache (keys only, refreshed now and then). */
async function cachedThumbnailIds(repoKey: string): Promise<Set<string>> {
  if (Date.now() - cachedThumbs.at < CACHED_KEYS_REFRESH_MS) return cachedThumbs.ids;
  const ids = new Set<string>();
  try {
    const db = await getDb();
    const keys = db ? await db.getAllKeysFromIndex("thumbnails", "byRepo", repoKey) : [];
    for (const key of keys) {
      const parts = String(key).split("::");
      const size = parts[parts.length - 1];
      if (size === "320" || size === "800") ids.add(parts[parts.length - 2]);
    }
  } catch {
    // No cache: everything comes from the network.
  }
  cachedThumbs = { at: Date.now(), ids };
  return ids;
}

/** Whether a background run may find the phone's own copy of this photo (not asked yet). */
function mayBeLocal(run: Run, mediaId: string): boolean {
  return Boolean(run.background?.localThumbnails && !run.background.notLocal.has(mediaId));
}

/** Whether a photo can be scanned without a download: maybe on the phone, or cached here. */
async function onDevice(run: Run, mediaId: string): Promise<boolean> {
  return mayBeLocal(run, mediaId) || (await cachedThumbnailIds(run.repoKey)).has(mediaId);
}

/** The phone's own 800px copy, for a background run (GET /_local/thumb/<mediaId> on the
 * runner's origin; 404 when the phone has none), or null. */
async function localThumbnail(run: Run, mediaId: string): Promise<Blob | null> {
  const bg = run.background;
  if (!bg || !mayBeLocal(run, mediaId)) return null;
  try {
    const res = await fetch(`/_local/thumb/${encodeURIComponent(mediaId)}`, { cache: "no-store" });
    if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) {
      const blob = await res.blob();
      if (blob.size > 0) return blob.type === "image/webp" ? blob : new Blob([blob], { type: "image/webp" });
    }
  } catch {
    // Not answered: the library's copy will do.
  }
  bg.notLocal.add(mediaId);
  return null;
}

type ThumbResult =
  | { kind: "blob"; blob: Blob; network: boolean }
  | { kind: "missing" }
  | { kind: "wait"; reason: ScanReason; until: number | null };

function networkBlock(run: Run): { reason: ScanReason; until: number | null } | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { reason: "offline", until: null };
  if (Date.now() < rateLimitedUntil) return { reason: "rate-limit", until: rateLimitedUntil };
  // A background run only starts on a network the phone's backup may use.
  if (run.background) return null;
  const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  const metered = connection?.type === "cellular" || connection?.saveData === true;
  if (metered && !getScanStatus().mobileData) return { reason: "cellular", until: null };
  return null;
}

async function fetchThumb(run: Run, mediaId: string, size: 800 | 320): Promise<Blob | null | ThumbResult> {
  const budget = takeBudget(run);
  if (!budget.ok) return { kind: "wait", reason: "budget", until: budget.until };
  try {
    // Not written to the thumbnail cache: scanning thousands of photos mustn't fill the device.
    const bytes = await withRepo((repo) => getContentBinary(repo, thumbnailPath(mediaId, size)), run.repoKey);
    return bytes ? new Blob([bytes], { type: "image/webp" }) : null;
  } catch (err) {
    if (err instanceof ApiError && err.kind === "rate-limit") {
      rateLimitedUntil = Date.now() + (err.retryAfterSec ?? 300) * 1000;
      return { kind: "wait", reason: "rate-limit", until: rateLimitedUntil };
    }
    if (err instanceof ApiError && err.kind === "offline") return { kind: "wait", reason: "offline", until: null };
    throw err;
  }
}

/** The phone's own copy first (background runs), then 800px preferred, 320px fallback: this
 * device's cached copies before any download. */
async function thumbnailFor(run: Run, item: MediaIndexEntry): Promise<ThumbResult> {
  const local = await localThumbnail(run, item.id);
  if (local) return { kind: "blob", blob: local, network: false };
  for (const size of [800, 320] as const) {
    const cached = await getCachedThumbnail(run.repoKey, item.id, size);
    if (cached) return { kind: "blob", blob: cached, network: false };
  }
  const blocked = networkBlock(run);
  if (blocked) return { kind: "wait", ...blocked };
  for (const size of [800, 320] as const) {
    const got = await fetchThumb(run, item.id, size);
    if (got instanceof Blob) return { kind: "blob", blob: got, network: true };
    if (got !== null) return got;
  }
  return { kind: "missing" };
}

// --- the phone's background run, seen from the app -------------------------------------------

/** Holds the scan up (briefly) until the phone has said whether a background run is going. */
function checkBackgroundRun(): void {
  if (getBackgroundFaceScan().support === "no") return;
  const check = ++backgroundCheck;
  backgroundChecking = true;
  const done = () => {
    window.clearTimeout(timer);
    if (check !== backgroundCheck || !backgroundChecking) return;
    backgroundChecking = false;
    wake();
  };
  const timer = window.setTimeout(done, BACKGROUND_CHECK_MAX_MS);
  void refreshBackgroundFaceScan().finally(done);
}

/** Waits while the phone's background run goes, then reads what it committed before going on. */
function onBackgroundScan(): void {
  const { status } = getBackgroundFaceScan();
  setScanStatus({ background: Boolean(status?.enabled) });
  if (!status) return;
  const seen = backgroundSeen;
  backgroundSeen = { running: status.running, lastRunAt: status.lastRunAt };
  const endedSinceSeen = seen
    ? seen.running || seen.lastRunAt !== status.lastRunAt
    : status.lastRunAt !== null && Date.now() - status.lastRunAt < RECENT_BACKGROUND_RUN_MS;
  if (!status.running && endedSinceSeen) {
    // Read twice: a read already going may have started before the run's last commit.
    backgroundSettling = true;
    void syncFaces({ force: true })
      .then(() => syncFaces({ force: true }))
      .finally(() => {
        backgroundSettling = false;
        wake();
      });
  }
  wake();
}

// --- the loop --------------------------------------------------------------------------------

/** Checked already: faces found (here or on another device), or it couldn't be read. */
function isDone(mediaId: string): boolean {
  return hasFaces(mediaId) || failed.has(mediaId);
}

function progress(items: readonly MediaIndexEntry[]): { done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const item of items) {
    if (!isScannable(item)) continue;
    total++;
    if (isDone(item.id)) done++;
  }
  return { done, total };
}

/** Why scanning can't go on right now (null = go). */
function blocker(run: Run): { state: ScanState; reason: ScanReason | null; message?: string } | null {
  const library = getLibrarySnapshot();
  const faces = getFacesSnapshot();
  const offline = navigator.onLine === false;
  if (faces.foreignModel) return { state: "paused", reason: "other-model" };
  if (faces.error?.kind === "auth" || library.error?.kind === "auth") return { state: "error", reason: "signed-out" };
  if (!run.background) {
    if (getScanStatus().paused) return { state: "paused", reason: "user" };
    if (document.visibilityState !== "visible") return { state: "paused", reason: "hidden" };
    if (backgroundChecking) return { state: "loading", reason: "starting" };
    if (backgroundSettling || getBackgroundFaceScan().status?.running) return { state: "waiting", reason: "background" };
  }
  if (library.repoKey !== run.repoKey || !library.hydrated || !faces.loaded) return { state: "loading", reason: "starting" };
  // Without the latest faces.json this device would redo another device's work (a failed
  // read doesn't block: the commit merges whatever was missed).
  const librarySettled = library.synced || library.error !== null;
  const facesSettled = faces.synced || faces.error !== null;
  if (!offline && (!librarySettled || !facesSettled)) return { state: "loading", reason: "starting" };
  // The phone's own backup runs natively off this page and doesn't compete with the scan (a
  // big first backup would otherwise starve it for days); this page's uploads and syncs do.
  const uploads = getWebUploadProgress();
  if ((uploads.active && !uploads.paused) || library.syncing) return { state: "waiting", reason: "busy" };
  if (engineError) return { state: "unavailable", reason: null, message: engineError };
  return null;
}

function readError(what: string, err: LibraryError): string {
  return err.kind === "rate-limit" ? ENDED.rateLimit : `Couldn't read ${what}: ${err.message}`;
}

/** Why a background run can't go on at all (it ends then), or null. */
function backgroundEnd(): string | null {
  const library = getLibrarySnapshot();
  const faces = getFacesSnapshot();
  if (faces.foreignModel) return ENDED.otherModel;
  if (faces.error?.kind === "auth" || library.error?.kind === "auth") return ENDED.signedOut;
  if (faces.error?.code === "corrupt_manifest") return faces.error.message;
  // Offline it can still go on with the phone's own copies; the commit waits for the next run.
  if (!library.synced && library.error && library.error.kind !== "offline") return readError("the library", library.error);
  if (!faces.synced && faces.error && faces.error.kind !== "offline") return readError("manifest/faces.json", faces.error);
  if (engineError) return `Face grouping can't run in the background on this phone: ${engineError}`;
  return null;
}

function nextItem(items: readonly MediaIndexEntry[], accept?: (item: MediaIndexEntry) => boolean) {
  for (const item of items) {
    if (!isScannable(item) || isDone(item.id)) continue;
    if (accept && !accept(item)) continue;
    return item;
  }
  return null;
}

/** The model for this run; background runs go straight to WebAssembly, with local model files. */
function createEngine(run: Run): Promise<FaceEngine> {
  if (!run.background) return createFaceEngine();
  const options: FaceEngineOptions = { cacheModels: false, detectTimeoutMs: BACKGROUND_DETECT_TIMEOUT_MS, backends: BACKGROUND_BACKENDS };
  return createFaceEngine(options);
}

async function ensureEngine(run: Run): Promise<FaceEngine> {
  window.clearTimeout(engineDisposeTimer);
  engineDisposeTimer = 0;
  if (engine) return engine;
  setScanStatus({ state: "loading", reason: null });
  engine = await createEngine(run);
  setScanStatus({ backend: engine.backend });
  return engine;
}

function disposeEngineSoon() {
  if (!engine || engineDisposeTimer) return;
  engineDisposeTimer = window.setTimeout(() => {
    engineDisposeTimer = 0;
    engine?.dispose();
    engine = null;
  }, ENGINE_IDLE_DISPOSE_MS);
}

function toScanned(faces: Awaited<ReturnType<FaceEngine["detect"]>>): ScannedFace[] {
  const out: ScannedFace[] = [];
  for (const face of faces) {
    const box = normalizeBox(face.box);
    const emb = quantizeEmbedding(face.descriptor);
    if (box && emb) out.push({ box, score: Math.round(face.score * 100) / 100, emb });
  }
  return out;
}

/** Keeps a background run's IndexedDB writes in view, so it can wait for them before it ends. */
function track(run: Run, write: Promise<void>): void {
  const writes = run.background?.writes;
  if (!writes) return;
  writes.add(write);
  void write.finally(() => writes.delete(write));
}

async function markFailed(run: Run, mediaId: string, reason: string) {
  failed.add(mediaId);
  const scan = { repoKey: run.repoKey, mediaId, model: FACE_MODEL, faces: null, failed: reason, at: Date.now() };
  scans.set(mediaId, { ...scan, key: `${run.repoKey}::${mediaId}` });
  await idb.writeScan(scan);
}

/** Ends a background run (the first reason sticks) and wakes its loop. */
function endRun(run: Run, reason: string): void {
  const bg = run.background;
  if (!bg || bg.reason !== null) return;
  bg.reason = reason;
  run.stopped = true;
  bg.onEnd();
  wake();
}

/** Tells a background run's host how far it is: every few photos, and every few seconds
 * while photos come in. */
function reportProgress(run: Run, force = false) {
  const bg = run.background;
  if (!bg) return;
  const now = Date.now();
  const fresh = bg.checked - bg.reported.checked;
  if (!force && fresh < PROGRESS_EVERY && (fresh === 0 || now - bg.reported.at < PROGRESS_INTERVAL_MS)) return;
  const { done, total } = progress(getLibrarySnapshot().items);
  bg.reported = { checked: bg.checked, at: now };
  try {
    bg.onProgress(bg.checked, bg.checked + Math.max(0, total - done));
  } catch {
    // The host's trouble; the run goes on.
  }
}

function countChecked(run: Run) {
  if (!run.background) return;
  run.background.checked += 1;
  reportProgress(run);
}

/** Waits out a budget, rate-limit or offline pause; a background run that couldn't go on
 * before its deadline anyway ends instead (a used-up budget counts as the deadline). */
async function waitFor(run: Run, reason: ScanReason, until: number | null): Promise<void> {
  setScanStatus({ state: "waiting", reason, resumeAt: until, message: null });
  const bg = run.background;
  if (bg && until !== null && until >= bg.stopAt) {
    if (reason === "budget") bg.resumeAt = until;
    endRun(run, reason === "rate-limit" ? ENDED.rateLimit : "deadline");
    return;
  }
  await sleep(until ? Math.min(60_000, Math.max(1000, until - Date.now())) : 5000);
}

async function scanLoop(run: Run): Promise<void> {
  const bg = run.background;
  let consecutiveErrors = 0;
  while (!run.stopped) {
    const items = getLibrarySnapshot().items;
    setScanStatus(progress(items));

    const end = bg ? backgroundEnd() : null;
    if (end) return endRun(run, end);
    const block = blocker(run);
    if (block) {
      setScanStatus({ state: block.state, reason: block.reason, message: block.message ?? null, resumeAt: null });
      if (block.state === "paused" || block.state === "unavailable") disposeEngineSoon();
      await sleep(block.state === "loading" ? 1000 : 2500);
      continue;
    }
    if (bg) {
      // The library is in: "0 of 8,000" right away.
      if (bg.reported.at === 0) reportProgress(run, true);
    } else if (Date.now() - lastInputAt < QUIET_AFTER_INPUT_MS) {
      await sleep(QUIET_AFTER_INPUT_MS);
      continue;
    }

    let item = nextItem(items);
    if (!item) {
      if (bg) {
        // Nothing left is only known with the library read from GitHub (not just this origin's copy).
        const library = getLibrarySnapshot();
        return endRun(run, !library.synced && library.error ? readError("the library", library.error) : "done");
      }
      setScanStatus({ state: "done", reason: null, message: null, resumeAt: null });
      disposeEngineSoon();
      flushFacesSoon();
      await sleep(15_000);
      continue;
    }

    // An earlier visit already ran the model on this one (its commit was lost): reuse it.
    const stored = scans.get(item.id);
    if (stored?.model === FACE_MODEL && stored.faces) {
      await addScanResult(item.id, stored.faces);
      if (bg) {
        countChecked(run);
        await yieldToPage();
      }
      continue;
    }

    // While downloads must wait, keep going with photos whose thumbnails are on this device.
    const blocked = networkBlock(run);
    if (blocked && !(await onDevice(run, item.id))) {
      const cached = await cachedThumbnailIds(run.repoKey);
      const onPhone = nextItem(items, (i) => cached.has(i.id) || mayBeLocal(run, i.id));
      if (!onPhone) {
        await waitFor(run, blocked.reason, blocked.until);
        continue;
      }
      item = onPhone;
    }

    const started = Date.now();
    try {
      const thumb = await thumbnailFor(run, item);
      if (run.stopped) return;
      if (thumb.kind === "wait") {
        await waitFor(run, thumb.reason, thumb.until);
        continue;
      }
      if (thumb.kind === "missing") {
        await markFailed(run, item.id, "no-thumbnail");
        countChecked(run);
        continue;
      }
      const model = await ensureEngine(run);
      if (run.stopped) return;
      setScanStatus({ state: "scanning", reason: null, message: null, resumeAt: null, backend: model.backend });
      let faces: ScannedFace[];
      try {
        faces = toScanned(await model.detect(item.id, thumb.blob));
      } catch (err) {
        if (err instanceof FaceDecodeError) {
          await markFailed(run, item.id, "decode");
          countChecked(run);
          continue;
        }
        throw err;
      }
      const scan = { repoKey: run.repoKey, mediaId: item.id, model: FACE_MODEL, faces, at: Date.now() };
      scans.set(item.id, { ...scan, key: `${run.repoKey}::${item.id}` });
      track(run, idb.writeScan(scan));
      await addScanResult(item.id, faces);
      countChecked(run);
      consecutiveErrors = 0;
    } catch (err) {
      if (err instanceof FaceEngineUnavailableError) {
        engineError = err.message || "Face grouping can't run on this device.";
        engine = null;
        continue;
      }
      if (err instanceof ApiError && err.kind === "auth") {
        setScanStatus({ state: "error", reason: "signed-out", message: err.message });
        if (bg) return endRun(run, ENDED.signedOut);
        await sleep(10_000);
        continue;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Something is off with this photo or the model: skip it rather than loop on it.
        await markFailed(run, item.id, "error");
        countChecked(run);
        consecutiveErrors = 0;
        engine?.dispose();
        engine = null;
      }
      setScanStatus({ state: "error", reason: null, message: err instanceof Error ? err.message : String(err) });
      await sleep(5000 * consecutiveErrors);
      continue;
    }
    if (bg) {
      // Nobody is using the page: just let its other work (IndexedDB, replies) through.
      await yieldToPage();
    } else {
      await sleep(Math.max(MIN_GAP_MS, Date.now() - started));
      await idle();
    }
  }
}

async function runWithLock(run: Run): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) {
    await scanLoop(run);
    return;
  }
  while (!run.stopped) {
    const got = await locks.request(`404gb-faces-scan:${run.repoKey}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await scanLoop(run);
      return true;
    });
    if (got) return;
    if (run.background) {
      endRun(run, ENDED.otherRun);
      return;
    }
    setScanStatus({ state: "waiting", reason: "other-tab", resumeAt: null, message: null });
    await sleep(OTHER_TAB_RETRY_MS);
  }
}

async function start(run: Run): Promise<void> {
  ensureFaces(run.repoKey);
  if (!run.background) {
    installInputListeners();
    startBackupWatcher();
  }
  failed.clear();
  scans = new Map();
  for (const scan of await idb.readScans(run.repoKey)) {
    if (scan.model !== FACE_MODEL) continue;
    scans.set(scan.mediaId, scan);
    if (scan.failed) failed.add(scan.mediaId);
  }
  if (run.stopped) return;
  await runWithLock(run);
}

let unsubscribers: Array<() => void> = [];

/** Starts scanning the library `repoKey` (no-op when already doing so). */
export function startFaceScanner(repoKey: string): void {
  if (typeof window === "undefined" || current?.repoKey === repoKey) return;
  stopFaceScanner();
  const run: Run = { repoKey, stopped: false, background: null };
  current = run;
  setScanStatus({ repoKey, state: "loading", reason: "starting", done: 0, total: 0, message: null, resumeAt: null });
  unsubscribers = [
    subscribeLibrary(wake),
    subscribeFaces(wake),
    subscribeBackup(wake),
    subscribeWebUploads(wake),
    subscribeBackgroundFaceScan(onBackgroundScan),
    onScanCommand((command) => {
      if (command === "rescan") void rescan(run);
      wake();
    }),
  ];
  checkBackgroundRun();
  const onVisible = () => {
    // Coming back is when the phone stops its background run (if one is going).
    if (document.visibilityState === "visible") checkBackgroundRun();
    wake();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onVisible);
  unsubscribers.push(
    () => document.removeEventListener("visibilitychange", onVisible),
    () => window.removeEventListener("online", onVisible)
  );
  void start(run);
}

export function stopFaceScanner(): void {
  if (!current) return;
  current.stopped = true;
  current = null;
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  wake();
  engine?.dispose();
  engine = null;
  setScanStatus({ repoKey: null, state: "idle", reason: null });
}

async function rescan(run: Run): Promise<void> {
  failed.clear();
  scans.clear();
  engineError = null;
  rateLimitedUntil = 0;
  cachedThumbs = { at: 0, ids: new Set() };
  await idb.clearScans(run.repoKey);
  await syncFaces({ force: true });
  wake();
}

// --- background runs -------------------------------------------------------------------------

export interface BackgroundScanOptions {
  /** Thumbnail downloads from GitHub allowed per hour. */
  budgetPerHour: number;
  /** Epoch ms by which what was found must be committed. */
  deadlineAt: number;
  /** Ask GET /_local/thumb/<mediaId> (the phone's own copy) before anything else. */
  localThumbnails: boolean;
  /** Aborted when the host asks the run to stop. */
  signal: AbortSignal;
  onProgress(checked: number, total: number): void;
}

export interface BackgroundScanResult {
  /** Photos this run checked. */
  checked: number;
  /** "done" (nothing left), "deadline", "stopped", or why the run was cut short. */
  reason: string;
  /** Photos still to check, or null before the library was in. */
  left: number | null;
  /** When a used-up download budget frees up, if that ended the run (the host waits for it). */
  resumeAt: number | null;
}

/** One commit of everything found (as much as fits in time); what kept it from landing, or null. */
async function saveFound(run: Run): Promise<string | null> {
  const outcome = await Promise.race([commitPendingFaces(), delay(FINAL_COMMIT_MS).then(() => "timeout" as const)]);
  // Whatever didn't make it stays on this device for the next run.
  await Promise.race([Promise.all([savePendingFaces(), ...(run.background?.writes ?? [])]), delay(3000)]);
  if (outcome === "timeout") return ENDED.saveTimeout;
  if (!outcome) return null;
  if (outcome.kind === "auth") return ENDED.signedOut;
  if (outcome.kind === "rate-limit") return ENDED.rateLimit;
  return `The people found couldn't be saved yet (${outcome.message}). They're saved next time.`;
}

/**
 * The background People runner's scan of `repoKey` (lib/faces/runner.ts; the library and
 * faces stores must point at it): photo after photo until everything is checked, the deadline
 * (less the commit's time), a stop request or something it can't get past; then one commit of
 * what it found. Resolves once that commit has landed or couldn't.
 */
export async function runBackgroundScan(repoKey: string, options: BackgroundScanOptions): Promise<BackgroundScanResult> {
  stopFaceScanner();
  const workerTimers = createWorkerTimers();
  timers = workerTimers ?? windowTimers;
  const startedAt = Date.now();
  const deadlineAt = Number.isFinite(options.deadlineAt) ? options.deadlineAt : startedAt + DEFAULT_RUN_MS;
  const budget = Math.max(0, Math.floor(options.budgetPerHour));
  let onEnd = () => {};
  const ended = new Promise<void>((resolve) => {
    onEnd = resolve;
  });
  const bg: Background = {
    budgetPerHour: budget,
    burstPerMinute: Math.max(NETWORK_BURST_PER_MINUTE, Math.ceil(budget / 20)),
    stopAt: Math.max(startedAt + (deadlineAt - startedAt) / 2, deadlineAt - COMMIT_MARGIN_MS),
    localThumbnails: options.localThumbnails,
    notLocal: new Set(),
    checked: 0,
    resumeAt: null,
    reported: { checked: 0, at: 0 },
    onProgress: options.onProgress,
    reason: null,
    onEnd,
    writes: new Set(),
  };
  const run: Run = { repoKey, stopped: false, background: bg };
  current = run;
  setScanStatus({ repoKey, state: "loading", reason: "starting", done: 0, total: 0, message: null, resumeAt: null });
  unsubscribers = [subscribeLibrary(wake), subscribeFaces(wake)];
  const stop = () => endRun(run, "stopped");
  if (options.signal.aborted) stop();
  else options.signal.addEventListener("abort", stop);
  const deadlineTimer = timers.set(() => endRun(run, "deadline"), Math.max(0, bg.stopAt - Date.now()));

  const loop = start(run).catch((err: unknown) => {
    endRun(run, `Something went wrong: ${err instanceof Error ? err.message : String(err)}`);
  });
  // A stop or the deadline can come while a photo is in hand: it gets a moment, then the commit
  // goes ahead without it (the detector's result is kept on this device for the next run).
  await Promise.race([loop, ended.then(() => Promise.race([loop, delay(STOP_GRACE_MS)]))]);
  timers.clear(deadlineTimer);
  options.signal.removeEventListener("abort", stop);

  let reason = bg.reason ?? "stopped";
  const saveError = await saveFound(run);
  // It did what it set out to, except saving: that's what the app should hear about.
  if (saveError && (reason === "done" || reason === "deadline" || reason === "stopped")) reason = saveError;
  reportProgress(run, true);
  const library = getLibrarySnapshot();
  const counts = progress(library.items);
  const left = library.hydrated && library.repoKey === repoKey ? Math.max(0, counts.total - counts.done) : null;
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  if (current === run) current = null;
  setScanStatus({ repoKey: null, state: "idle", reason: null });
  // The photo in hand, if any, finishes on its own; then the model and the timer worker go.
  void loop.finally(() => {
    engine?.dispose();
    engine = null;
    if (timers === workerTimers) timers = windowTimers;
    workerTimers?.dispose();
  });
  return { checked: bg.checked, reason, left, resumeAt: reason === "deadline" ? bg.resumeAt : null };
}
