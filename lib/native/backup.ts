// Bridge to the native "Backup" Capacitor plugin in the Android app
// (404gb_mobile: android/app/src/main/java/com/fourzerofourgb/app/backup/).
// The Java side implements exactly these methods and events. Only call them when
// hasNativePlugin("Backup") is true; everywhere else they reject.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { MediaIndexEntry } from "@/lib/media/types";

export type BackupFolders = "all" | "camera";

export type BackupState =
  | "off"
  | "idle" // enabled, nothing to upload
  | "scanning"
  | "uploading"
  | "waiting" // enabled, but something is in the way: see BackupStatus.waitingFor
  | "needs_sign_in" // no GitHub token stored, or GitHub answered 401
  | "needs_permission"; // photo/video access missing or only partially granted

/** Why queued backups aren't running (older app builds don't report it). */
export type BackupWaitReason =
  | "rate_limit" // GitHub's upload limit; resumes by itself at resumeAt
  | "network" // no internet connection
  | "wifi" // Wi-Fi only is on and the phone is on mobile data
  | "roaming" // mobile data is allowed, but never while roaming
  | "charging" // only-while-charging is on and the phone isn't charging
  | "battery"; // paused while the battery is low

export interface BackupStatus {
  enabled: boolean;
  wifiOnly: boolean;
  chargingOnly: boolean;
  folders: BackupFolders;
  state: BackupState;
  /** Items found on the phone that still need uploading. */
  pending: number;
  /** Items this phone has backed up successfully. */
  uploaded: number;
  /** Items skipped because they were already in the library. */
  skippedDuplicates: number;
  /** Items that failed after retries (see retryFailed). */
  failed: number;
  current: { name: string; bytesDone: number; bytesTotal: number } | null;
  /** Epoch milliseconds of the last successful upload. */
  lastBackupAt: number | null;
  /** True when Android battery optimization may delay backups. */
  batteryOptimized: boolean;
  /** Set while state is "waiting"; null when Android just hasn't started the work yet. */
  waitingFor?: BackupWaitReason | null;
  /** Epoch milliseconds when a GitHub rate-limit pause ends. */
  resumeAt?: number | null;
}

export interface BackupOptions {
  wifiOnly: boolean;
  chargingOnly: boolean;
  /** Also back up photos/videos already on the phone, not just new ones. */
  includeExisting: boolean;
  folders: BackupFolders;
}

/** The GitHub session the app and the background worker share (docs/STANDALONE.md). */
export interface BackupAuth {
  token: string;
  login: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface ItemsUploadedEvent {
  /** Index entries the worker just committed, newest last. */
  entries: MediaIndexEntry[];
}

export interface SaveProgress {
  mediaId: string;
  bytesDone: number;
  bytesTotal: number;
}

export interface BackupPlugin {
  getStatus(): Promise<BackupStatus>;
  /** Requests photo/video, location-metadata and notification permissions, then starts backup.
   * Rejects with code "PERMISSION_DENIED" if photo/video access is refused. */
  enable(options: BackupOptions): Promise<BackupStatus>;
  disable(): Promise<BackupStatus>;
  setOptions(
    options: Partial<Pick<BackupOptions, "wifiOnly" | "chargingOnly" | "folders">>
  ): Promise<BackupStatus>;
  backupNow(): Promise<void>;
  retryFailed(): Promise<void>;
  /** Stores the GitHub session for the worker. A different owner/repo than the one the phone
   * was backing up into queues everything again for the new repo. Kicks backup when enabled. */
  setAuth(options: BackupAuth): Promise<BackupStatus>;
  /** The stored session, or null when signed out. */
  getAuth(): Promise<{ auth: BackupAuth | null }>;
  /** Forgets the token on this phone (backup pauses as "needs_sign_in"; the ledger is kept). */
  clearAuth(): Promise<BackupStatus>;
  /** Downloads the original into the phone's gallery (Pictures/404GB or Movies/404GB). */
  saveToDevice(options: { mediaId: string }): Promise<{ uri: string }>;
  /** Downloads the original and opens Android's share sheet. */
  shareMedia(options: { mediaId: string }): Promise<void>;
  openBatterySettings(): Promise<void>;
  addListener(
    eventName: "statusChanged",
    listener: (status: BackupStatus) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "saveProgress",
    listener: (progress: SaveProgress) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "itemsUploaded",
    listener: (event: ItemsUploadedEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const Backup = registerPlugin<BackupPlugin>("Backup");
