// Bridge to the native "Backup" Capacitor plugin in the Android app
// (404gb_mobile: android/app/src/main/java/com/fourzerofourgb/app/backup/).
// The Java side implements exactly these methods and events. Only call them when
// hasNativePlugin("Backup") is true; everywhere else they reject.

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type BackupFolders = "all" | "camera";

export type BackupState =
  | "off"
  | "idle" // enabled, nothing to upload
  | "scanning"
  | "uploading"
  | "waiting" // enabled, but Wi-Fi/charging/network conditions aren't met yet
  | "needs_sign_in" // the server rejected the app's session (401)
  | "needs_permission"; // photo/video access missing or only partially granted

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
}

export interface BackupOptions {
  wifiOnly: boolean;
  chargingOnly: boolean;
  /** Also back up photos/videos already on the phone, not just new ones. */
  includeExisting: boolean;
  folders: BackupFolders;
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
}

export const Backup = registerPlugin<BackupPlugin>("Backup");
