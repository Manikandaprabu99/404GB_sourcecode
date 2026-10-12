// Finds faces in the library a little at a time while the app is open and visible
// (docs/FACES.md): newest photos first, from thumbnails already on this device when it has
// them, otherwise from GitHub within a small hourly budget. Pauses while the app is hidden,
// while this page's uploads/sync are busy, right after the user touches the screen, and when
// the user pauses it. One tab scans at a time. Loaded lazily (app/components/people/PeopleScanner).

import { getDb } from "@/lib/cache/db";
import { getCachedThumbnail } from "@/lib/cache/thumbnailCache";
import { getContentBinary } from "@/lib/github";
import { ApiError, withRepo } from "@/lib/library/api";
import { startBackupWatcher, subscribeBackup } from "@/lib/library/backupStore";
import { getLibrarySnapshot, subscribeLibrary } from "@/lib/library/mediaStore";
import { getWebUploadProgress, subscribeWebUploads } from "@/lib/library/uploadProgress";
import { thumbnailPath, type MediaIndexEntry } from "@/lib/media/types";
import type { ScannedFace } from "./cluster";
import { FACE_MODEL, normalizeBox, quantizeEmbedding } from "./doc";
import { createFaceEngine, FaceDecodeError, FaceEngineUnavailableError, type FaceEngine } from "./engine";
import * as idb from "./idb";
import { getScanStatus, onScanCommand, setScanStatus, type ScanReason, type ScanState } from "./scanStatus";
import {
  addScanResult,
  ensureFaces,
  flushFacesSoon,
  getFacesSnapshot,
  hasFaces,
  subscribeFaces,
  syncFaces,
} from "./store";

/** Thumbnails fetched from GitHub for scanning, per hour (GitHub allows 5,000 calls/hour in all). */
export const NETWORK_BUDGET_PER_HOUR = 600;
const NETWORK_BURST_PER_MINUTE = 30;
/** Rest between photos at least this long, and at least as long as the last one took. */
const MIN_GAP_MS = 250;
/** Wait this long after the user last touched/scrolled before running the model again. */
const QUIET_AFTER_INPUT_MS = 1200;
const OTHER_TAB_RETRY_MS = 30_000;
const ENGINE_IDLE_DISPOSE_MS = 60_000;
const CACHED_KEYS_REFRESH_MS = 3 * 60_000;
const MAX_CONSECUTIVE_ERRORS = 3;
const BUDGET_KEY_PREFIX = "404gb-faces:budget:";

interface Run {
  repoKey: string;
  stopped: boolean;
}

let current: Run | null = null;
let engine: FaceEngine | null = null;
let engineError: string | null = null;
let engineDisposeTimer = 0;
let lastInputAt = 0;
let wakeUp: (() => void) | null = null;
let rateLimitedUntil = 0;
let inputListenersInstalled = false;

const failed = new Set<string>();
let scans = new Map<string, idb.StoredScan>();
let cachedThumbs: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      if (wakeUp === done) wakeUp = null;
      resolve();
    }
    wakeUp = done;
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
  for (const type of ["pointerdown", "wheel", "touchmove", "keydown"]) window.addEventListener(type, mark, opts);
  document.addEventListener("scroll", mark, opts);
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
function takeBudget(repoKey: string): { ok: true } | { ok: false; until: number } {
  const now = Date.now();
  const recent = readBudget(repoKey).filter((t) => t > now - 3600_000 && t <= now);
  if (recent.length >= NETWORK_BUDGET_PER_HOUR) return { ok: false, until: Math.min(...recent) + 3600_000 };
  const lastMinute = recent.filter((t) => t > now - 60_000);
  if (lastMinute.length >= NETWORK_BURST_PER_MINUTE) return { ok: false, until: Math.min(...lastMinute) + 60_000 };
  recent.push(now);
  try {
    window.localStorage.setItem(BUDGET_KEY_PREFIX + repoKey, JSON.stringify(recent));
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

type ThumbResult =
  | { kind: "blob"; blob: Blob; network: boolean }
  | { kind: "missing" }
  | { kind: "wait"; reason: ScanReason; until: number | null };

function networkBlock(): { reason: ScanReason; until: number | null } | null {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { reason: "offline", until: null };
  if (Date.now() < rateLimitedUntil) return { reason: "rate-limit", until: rateLimitedUntil };
  const connection = (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection;
  const metered = connection?.type === "cellular" || connection?.saveData === true;
  if (metered && !getScanStatus().mobileData) return { reason: "cellular", until: null };
  return null;
}

async function fetchThumb(run: Run, mediaId: string, size: 800 | 320): Promise<Blob | null | ThumbResult> {
  const budget = takeBudget(run.repoKey);
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

/** 800px preferred, 320px fallback; this device's cached copies before any download. */
async function thumbnailFor(run: Run, item: MediaIndexEntry): Promise<ThumbResult> {
  for (const size of [800, 320] as const) {
    const cached = await getCachedThumbnail(run.repoKey, item.id, size);
    if (cached) return { kind: "blob", blob: cached, network: false };
  }
  const blocked = networkBlock();
  if (blocked) return { kind: "wait", ...blocked };
  for (const size of [800, 320] as const) {
    const got = await fetchThumb(run, item.id, size);
    if (got instanceof Blob) return { kind: "blob", blob: got, network: true };
    if (got !== null) return got;
  }
  return { kind: "missing" };
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
  if (getScanStatus().paused) return { state: "paused", reason: "user" };
  if (document.visibilityState !== "visible") return { state: "paused", reason: "hidden" };
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

function nextItem(items: readonly MediaIndexEntry[], only?: ReadonlySet<string>) {
  for (const item of items) {
    if (!isScannable(item) || isDone(item.id)) continue;
    if (only && !only.has(item.id)) continue;
    return item;
  }
  return null;
}

async function ensureEngine(): Promise<FaceEngine> {
  window.clearTimeout(engineDisposeTimer);
  engineDisposeTimer = 0;
  if (engine) return engine;
  setScanStatus({ state: "loading", reason: null });
  engine = await createFaceEngine();
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

async function markFailed(run: Run, mediaId: string, reason: string) {
  failed.add(mediaId);
  const scan = { repoKey: run.repoKey, mediaId, model: FACE_MODEL, faces: null, failed: reason, at: Date.now() };
  scans.set(mediaId, { ...scan, key: `${run.repoKey}::${mediaId}` });
  await idb.writeScan(scan);
}

async function scanLoop(run: Run): Promise<void> {
  let consecutiveErrors = 0;
  while (!run.stopped) {
    const items = getLibrarySnapshot().items;
    setScanStatus(progress(items));

    const block = blocker(run);
    if (block) {
      setScanStatus({ state: block.state, reason: block.reason, message: block.message ?? null, resumeAt: null });
      if (block.state === "paused" || block.state === "unavailable") disposeEngineSoon();
      await sleep(block.state === "loading" ? 1000 : 2500);
      continue;
    }
    if (Date.now() - lastInputAt < QUIET_AFTER_INPUT_MS) {
      await sleep(QUIET_AFTER_INPUT_MS);
      continue;
    }

    let item = nextItem(items);
    if (!item) {
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
      continue;
    }

    // While downloads must wait, keep going with photos whose thumbnails are on this device.
    const blocked = networkBlock();
    if (blocked && !(await cachedThumbnailIds(run.repoKey)).has(item.id)) {
      const cachedItem = nextItem(items, await cachedThumbnailIds(run.repoKey));
      if (!cachedItem) {
        setScanStatus({ state: "waiting", reason: blocked.reason, resumeAt: blocked.until, message: null });
        await sleep(blocked.until ? Math.min(60_000, Math.max(1000, blocked.until - Date.now())) : 5000);
        continue;
      }
      item = cachedItem;
    }

    const started = Date.now();
    try {
      const thumb = await thumbnailFor(run, item);
      if (run.stopped) return;
      if (thumb.kind === "wait") {
        setScanStatus({ state: "waiting", reason: thumb.reason, resumeAt: thumb.until, message: null });
        await sleep(thumb.until ? Math.min(60_000, Math.max(1000, thumb.until - Date.now())) : 5000);
        continue;
      }
      if (thumb.kind === "missing") {
        await markFailed(run, item.id, "no-thumbnail");
        continue;
      }
      const model = await ensureEngine();
      if (run.stopped) return;
      setScanStatus({ state: "scanning", reason: null, message: null, resumeAt: null, backend: model.backend });
      let faces: ScannedFace[];
      try {
        faces = toScanned(await model.detect(item.id, thumb.blob));
      } catch (err) {
        if (err instanceof FaceDecodeError) {
          await markFailed(run, item.id, "decode");
          continue;
        }
        throw err;
      }
      const scan = { repoKey: run.repoKey, mediaId: item.id, model: FACE_MODEL, faces, at: Date.now() };
      scans.set(item.id, { ...scan, key: `${run.repoKey}::${item.id}` });
      void idb.writeScan(scan);
      await addScanResult(item.id, faces);
      consecutiveErrors = 0;
    } catch (err) {
      if (err instanceof FaceEngineUnavailableError) {
        engineError = err.message || "Face grouping can't run on this device.";
        engine = null;
        continue;
      }
      if (err instanceof ApiError && err.kind === "auth") {
        setScanStatus({ state: "error", reason: "signed-out", message: err.message });
        await sleep(10_000);
        continue;
      }
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Something is off with this photo or the model: skip it rather than loop on it.
        await markFailed(run, item.id, "error");
        consecutiveErrors = 0;
        engine?.dispose();
        engine = null;
      }
      setScanStatus({ state: "error", reason: null, message: err instanceof Error ? err.message : String(err) });
      await sleep(5000 * consecutiveErrors);
      continue;
    }
    await sleep(Math.max(MIN_GAP_MS, Date.now() - started));
    await idle();
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
    setScanStatus({ state: "waiting", reason: "other-tab", resumeAt: null, message: null });
    await sleep(OTHER_TAB_RETRY_MS);
  }
}

async function start(run: Run): Promise<void> {
  ensureFaces(run.repoKey);
  installInputListeners();
  startBackupWatcher();
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
  const run: Run = { repoKey, stopped: false };
  current = run;
  setScanStatus({ repoKey, state: "loading", reason: "starting", done: 0, total: 0, message: null, resumeAt: null });
  unsubscribers = [
    subscribeLibrary(wake),
    subscribeFaces(wake),
    subscribeBackup(wake),
    subscribeWebUploads(wake),
    onScanCommand((command) => {
      if (command === "rescan") void rescan(run);
      wake();
    }),
  ];
  const onVisible = () => wake();
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
