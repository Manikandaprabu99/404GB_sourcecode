// Background People matching on the phone (docs/FACES.md "Background") as the app sees it:
// whether this app build has it, the user's switch and how the last run went, from the Backup
// plugin. Read when something starts watching and whenever the app comes back to the
// foreground — opening the app stops a run, which then takes a few seconds to commit what it
// found — and every couple of seconds while a run is going. Small enough for the main bundle.

import { useSyncExternalStore } from "react";
import { Backup, type FaceScanStatus } from "@/lib/native/backup";
import { hasNativePlugin } from "@/lib/native/platform";

export interface BackgroundFaceScan {
  /** "no" in a browser and in app builds without background matching. */
  support: "unknown" | "no" | "yes";
  status: FaceScanStatus | null;
}

const POLL_WHILE_RUNNING_MS = 2000;

const UNKNOWN: BackgroundFaceScan = { support: "unknown", status: null };
const UNSUPPORTED: BackgroundFaceScan = { support: "no", status: null };

let snapshot: BackgroundFaceScan = UNKNOWN;
let inflight: Promise<void> | null = null;
let pollTimer = 0;
let watchersInstalled = false;
const listeners = new Set<() => void>();

function same(a: FaceScanStatus | null, b: FaceScanStatus | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.enabled === b.enabled &&
    a.running === b.running &&
    a.lastRunAt === b.lastRunAt &&
    a.lastChecked === b.lastChecked &&
    a.lastError === b.lastError
  );
}

function emit(next: BackgroundFaceScan) {
  if (next.support === snapshot.support && same(next.status, snapshot.status)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function toStatus(raw: unknown): FaceScanStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.enabled !== "boolean") return null;
  return {
    enabled: r.enabled,
    running: r.running === true,
    lastRunAt: count(r.lastRunAt) || null,
    lastChecked: count(r.lastChecked),
    lastError: typeof r.lastError === "string" && r.lastError ? r.lastError : null,
  };
}

function schedulePoll() {
  window.clearTimeout(pollTimer);
  pollTimer = 0;
  if (listeners.size === 0 || !snapshot.status?.running || document.visibilityState !== "visible") return;
  pollTimer = window.setTimeout(() => void refreshBackgroundFaceScan(), POLL_WHILE_RUNNING_MS);
}

/** Reads the status from the plugin again (concurrent calls share one read). */
export function refreshBackgroundFaceScan(): Promise<void> {
  if (typeof window === "undefined" || snapshot.support === "no") return Promise.resolve();
  if (!hasNativePlugin("Backup")) {
    emit(UNSUPPORTED);
    return Promise.resolve();
  }
  inflight ??= Backup.getFaceScanStatus()
    .then(
      (raw) => {
        const status = toStatus(raw);
        emit(status ? { support: "yes", status } : UNSUPPORTED);
      },
      // An app build from before background matching: the method isn't there.
      () => emit(UNSUPPORTED)
    )
    .finally(() => {
      inflight = null;
      schedulePoll();
    });
  return inflight;
}

/** Turns background matching on or off; the switch flips at once and goes back if that fails. */
export async function setBackgroundFaceScan(enabled: boolean): Promise<void> {
  const before = snapshot;
  if (before.status) emit({ support: "yes", status: { ...before.status, enabled } });
  try {
    const status = toStatus(await Backup.setFaceScan({ enabled }));
    if (status) emit({ support: "yes", status });
  } catch (err) {
    emit(before);
    void refreshBackgroundFaceScan();
    throw err;
  }
  schedulePoll();
}

function installWatchers() {
  if (watchersInstalled || typeof document === "undefined") return;
  watchersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && listeners.size > 0) void refreshBackgroundFaceScan();
    else schedulePoll();
  });
}

export function subscribeBackgroundFaceScan(listener: () => void): () => void {
  listeners.add(listener);
  installWatchers();
  void refreshBackgroundFaceScan();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) schedulePoll();
  };
}

export function getBackgroundFaceScan(): BackgroundFaceScan {
  return snapshot;
}

function getServerBackgroundFaceScan(): BackgroundFaceScan {
  return UNKNOWN;
}

/** The phone's background matching: support, switch and last run (Settings › People). */
export function useBackgroundFaceScan(): BackgroundFaceScan {
  return useSyncExternalStore(subscribeBackgroundFaceScan, getBackgroundFaceScan, getServerBackgroundFaceScan);
}
