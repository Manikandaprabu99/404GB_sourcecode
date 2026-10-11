// App-wide view of the native Backup plugin's status: one statusChanged
// listener shared by the gallery pill, the settings page and the library's
// refresh triggers.

import { Backup, type BackupStatus } from "@/lib/native/backup";
import { hasNativePlugin, isNativeApp } from "@/lib/native/platform";

export type BackupSupport = "unknown" | "browser" | "app-update-needed" | "available";

/** Counters at the start of the current backup run, for "3 of 12" progress. */
export interface BackupRun {
  startUploaded: number;
  startSkipped: number;
  startFailed: number;
}

export interface BackupSnapshot {
  support: BackupSupport;
  status: BackupStatus | null;
  run: BackupRun | null;
  error: string | null;
}

export type BackupProgressEvent = "uploaded" | "finished";

const INITIAL: BackupSnapshot = { support: "unknown", status: null, run: null, error: null };

let snapshot: BackupSnapshot = INITIAL;
let started = false;
const listeners = new Set<() => void>();
const progressListeners = new Set<(event: BackupProgressEvent) => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeBackup(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getBackupSnapshot(): BackupSnapshot {
  return snapshot;
}

export function getServerBackupSnapshot(): BackupSnapshot {
  return INITIAL;
}

/** Fires when the phone finishes uploading another item, and when a run ends. */
export function onBackupProgress(listener: (event: BackupProgressEvent) => void): () => void {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function isRunning(status: BackupStatus): boolean {
  return status.enabled && (status.state === "uploading" || status.state === "scanning");
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
    return err.message;
  }
  return String(err);
}

export function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return undefined;
}

export function applyBackupStatus(status: BackupStatus): void {
  const prev = snapshot.status;
  let run = snapshot.run;
  if (isRunning(status)) {
    run ??= {
      startUploaded: status.uploaded,
      startSkipped: status.skippedDuplicates,
      startFailed: status.failed,
    };
  } else {
    run = null;
  }
  snapshot = { support: "available", status, run, error: null };
  emit();
  if (prev && status.uploaded > prev.uploaded) {
    for (const listener of progressListeners) listener("uploaded");
  }
  if (prev && isRunning(prev) && !isRunning(status)) {
    for (const listener of progressListeners) listener("finished");
  }
}

export async function refreshBackupStatus(): Promise<void> {
  if (snapshot.support !== "available") return;
  try {
    applyBackupStatus(await Backup.getStatus());
  } catch (err) {
    snapshot = { ...snapshot, error: errorMessage(err) };
    emit();
  }
}

/** Detects plugin support once and keeps the status current (idempotent). */
export function startBackupWatcher(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  if (!isNativeApp()) {
    snapshot = { ...snapshot, support: "browser" };
    emit();
    return;
  }
  if (!hasNativePlugin("Backup")) {
    snapshot = { ...snapshot, support: "app-update-needed" };
    emit();
    return;
  }

  snapshot = { ...snapshot, support: "available" };
  emit();
  void refreshBackupStatus();
  Backup.addListener("statusChanged", applyBackupStatus).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshBackupStatus();
  });
}

export function backupRunProgress(
  status: BackupStatus,
  run: BackupRun | null
): { done: number; total: number; fraction: number } {
  const start = run ?? {
    startUploaded: status.uploaded,
    startSkipped: status.skippedDuplicates,
    startFailed: status.failed,
  };
  const done =
    Math.max(0, status.uploaded - start.startUploaded) +
    Math.max(0, status.skippedDuplicates - start.startSkipped) +
    Math.max(0, status.failed - start.startFailed);
  const total = done + Math.max(0, status.pending);
  const current =
    status.current && status.current.bytesTotal > 0
      ? Math.min(1, status.current.bytesDone / status.current.bytesTotal)
      : 0;
  return { done, total, fraction: total > 0 ? Math.min(1, (done + current) / total) : 0 };
}

function connectionType(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: { type?: string } }).connection?.type;
}

export type BackupPillIcon =
  | "sync"
  | "check"
  | "wifi"
  | "signal"
  | "charging"
  | "battery"
  | "clock"
  | "alert"
  | "off"
  | "update"
  | "lock";

export interface WaitInfo {
  /** Short, for the pill. */
  label: string;
  icon: BackupPillIcon;
  /** A sentence for Settings explaining what happens next. */
  detail: string;
}

function formatResumeTime(epochMs: number, now: number): string {
  const minutes = Math.max(1, Math.round((epochMs - now) / 60_000));
  if (minutes < 60) return minutes === 1 ? "in a minute" : `in ${minutes} min`;
  return `at ${new Date(epochMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Why a "waiting" backup isn't running. Newer app builds say so (waitingFor);
 * for older ones this guesses from the options and the browser's connection. */
export function describeWait(status: BackupStatus, now: number = Date.now()): WaitInfo {
  if ("waitingFor" in status) {
    switch (status.waitingFor) {
      case "rate_limit": {
        const when = status.resumeAt && status.resumeAt > now ? formatResumeTime(status.resumeAt, now) : "shortly";
        return {
          label: `GitHub limit · resumes ${when}`,
          icon: "clock",
          detail: `GitHub limits how fast a repo can take uploads, so backup paused itself. It resumes ${when} on its own.`,
        };
      }
      case "network":
        return {
          label: "Waiting for a connection",
          icon: "off",
          detail: "Backup continues as soon as the phone is online again.",
        };
      case "wifi":
        return {
          label: "Waiting for Wi-Fi",
          icon: "wifi",
          detail: "Wi-Fi only is on. Backup continues when you're on Wi-Fi, or allow mobile data below.",
        };
      case "roaming":
        return {
          label: "Paused while roaming",
          icon: "signal",
          detail: "Backup doesn't use mobile data while roaming. It continues on Wi-Fi or back home.",
        };
      case "charging":
        return {
          label: "Waiting to charge",
          icon: "charging",
          detail: "Only while charging is on. Backup continues when the phone is plugged in.",
        };
      case "battery":
        return {
          label: "Paused: battery low",
          icon: "battery",
          detail: "Backup pauses while the battery is low and continues by itself once it's charged a bit.",
        };
      default:
        return {
          label: "Starting soon",
          icon: "clock",
          detail: "Android starts backup at a moment that suits the battery, usually within a few minutes.",
        };
    }
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { label: "Waiting for a connection", icon: "off", detail: "Backup continues once you're online." };
  }
  const type = connectionType();
  const onWifi = type === "wifi" || type === "ethernet";
  if (status.wifiOnly && !(status.chargingOnly && onWifi)) {
    return { label: "Waiting for Wi-Fi", icon: "wifi", detail: "Backup continues when you're on Wi-Fi." };
  }
  if (status.chargingOnly) {
    return { label: "Waiting to charge", icon: "charging", detail: "Backup continues when the phone is plugged in." };
  }
  return { label: "Starting soon", icon: "clock", detail: "Android starts backup at a moment that suits the battery." };
}

export type BackupPillTone = "progress" | "ok" | "warn" | "action" | "muted";

export interface BackupPill {
  label: string;
  tone: BackupPillTone;
  icon: BackupPillIcon;
  href?: string;
  /** 0..1 while uploading. */
  progress?: number;
}

export function describeBackup(backup: BackupSnapshot): BackupPill | null {
  if (backup.support === "unknown" || backup.support === "browser") return null;
  if (backup.support === "app-update-needed") {
    return { label: "Update the app to turn on backup", tone: "muted", icon: "update", href: "/settings" };
  }

  const status = backup.status;
  if (!status) return null;
  if (!status.enabled || status.state === "off") {
    return { label: "Turn on backup", tone: "action", icon: "off", href: "/settings" };
  }

  switch (status.state) {
    case "needs_sign_in":
      // Settings, not "/": while the page's own session is fine, "/" would just route back here.
      return { label: "Sign in to keep backing up", tone: "warn", icon: "lock", href: "/settings" };
    case "needs_permission":
      return { label: "Allow photo access", tone: "warn", icon: "alert", href: "/settings" };
    case "waiting": {
      const wait = describeWait(status);
      return { label: wait.label, tone: "muted", icon: wait.icon, href: "/settings" };
    }
    case "scanning":
      return { label: "Checking for new items", tone: "progress", icon: "sync", href: "/settings" };
    case "uploading": {
      const { done, total, fraction } = backupRunProgress(status, backup.run);
      return {
        label: total > 0 ? `Backing up ${Math.min(done + 1, total)} of ${total}` : "Backing up",
        tone: "progress",
        icon: "sync",
        progress: fraction,
        href: "/settings",
      };
    }
    default:
      if (status.failed > 0) {
        return {
          label: status.failed === 1 ? "1 item couldn't back up" : `${status.failed} items couldn't back up`,
          tone: "warn",
          icon: "alert",
          href: "/settings",
        };
      }
      return { label: "Backed up", tone: "ok", icon: "check", href: "/settings" };
  }
}
