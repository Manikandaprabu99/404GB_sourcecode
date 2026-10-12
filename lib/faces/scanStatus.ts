// What the face scanner is doing, plus its device settings — small enough for the main bundle;
// the scanner itself (scanner.ts) is loaded later, when the app is idle.

export type ScanState =
  | "idle"
  | "loading"
  | "scanning"
  | "paused"
  | "waiting"
  | "done"
  | "unavailable"
  | "error";

export type ScanReason =
  | "user"
  | "hidden"
  | "busy"
  | "offline"
  | "cellular"
  | "budget"
  | "rate-limit"
  | "other-tab"
  | "other-model"
  | "signed-out"
  | "starting";

export interface ScanStatus {
  repoKey: string | null;
  state: ScanState;
  reason: ScanReason | null;
  /** Photos checked (found faces or not, here or on another device) out of all scannable ones. */
  done: number;
  total: number;
  /** TensorFlow.js backend the model runs on ("webgl", "wasm", "cpu"). */
  backend: string | null;
  /** When a budget or rate-limit wait ends (ms since epoch). */
  resumeAt: number | null;
  message: string | null;
  paused: boolean;
  mobileData: boolean;
}

const PAUSED_KEY = "404gb-faces:paused";
const MOBILE_DATA_KEY = "404gb-faces:mobile-data";
const BACKEND_KEY = "404gb-faces:backend";

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function readText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage disabled: the setting lasts for this visit.
  }
}

const SERVER: ScanStatus = {
  repoKey: null,
  state: "idle",
  reason: null,
  done: 0,
  total: 0,
  backend: null,
  resumeAt: null,
  message: null,
  paused: false,
  mobileData: false,
};

let status: ScanStatus = SERVER;
let initialized = false;
const listeners = new Set<() => void>();
const commandListeners = new Set<(command: "wake" | "rescan") => void>();

function init() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  // The backend is remembered so Settings can say where the model runs before it's loaded again.
  status = { ...status, paused: readFlag(PAUSED_KEY), mobileData: readFlag(MOBILE_DATA_KEY), backend: readText(BACKEND_KEY) };
}

export function subscribeScanStatus(listener: () => void): () => void {
  init();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getScanStatus(): ScanStatus {
  init();
  return status;
}

export function getServerScanStatus(): ScanStatus {
  return SERVER;
}

/** Scanner side: publishes a change (no-op when nothing changed). */
export function setScanStatus(patch: Partial<ScanStatus>): void {
  init();
  let changed = false;
  for (const key of Object.keys(patch) as Array<keyof ScanStatus>) {
    if (status[key] !== patch[key]) changed = true;
  }
  if (!changed) return;
  if (patch.backend) {
    try {
      window.localStorage.setItem(BACKEND_KEY, patch.backend);
    } catch {
      // Storage disabled.
    }
  }
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

/** Scanner side: Settings asked to wake up or re-scan. */
export function onScanCommand(listener: (command: "wake" | "rescan") => void): () => void {
  commandListeners.add(listener);
  return () => {
    commandListeners.delete(listener);
  };
}

export function setScanPaused(paused: boolean): void {
  writeFlag(PAUSED_KEY, paused);
  setScanStatus({ paused });
  for (const listener of commandListeners) listener("wake");
}

export function setScanMobileData(on: boolean): void {
  writeFlag(MOBILE_DATA_KEY, on);
  setScanStatus({ mobileData: on });
  for (const listener of commandListeners) listener("wake");
}

/** Checks every photo again, including ones that couldn't be read; names and corrections stay. */
export function requestRescan(): void {
  for (const listener of commandListeners) listener("rescan");
}
