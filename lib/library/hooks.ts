"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import {
  ensureAlbums,
  getAlbumsSnapshot,
  getServerAlbumsSnapshot,
  loadAlbums,
  subscribeAlbums,
  type AlbumsSnapshot,
} from "./albumsStore";
import {
  getBackupSnapshot,
  getServerBackupSnapshot,
  startBackupWatcher,
  subscribeBackup,
  type BackupSnapshot,
} from "./backupStore";
import {
  ensureLibrary,
  getLibrarySnapshot,
  getServerLibrarySnapshot,
  installLibraryWatchers,
  requestLibrarySync,
  subscribeLibrary,
  type LibrarySnapshot,
} from "./mediaStore";
import {
  getServerWebUploadProgress,
  getWebUploadProgress,
  subscribeWebUploads,
  type WebUploadProgress,
} from "./uploadProgress";

export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const MOUNT_SYNC_MIN_INTERVAL_MS = 1500;

/** The shared media library for a repo; syncs on mount and keeps itself fresh. */
export function useLibrary(repoKey: string): LibrarySnapshot {
  const snapshot = useSyncExternalStore(subscribeLibrary, getLibrarySnapshot, getServerLibrarySnapshot);
  useEffect(() => {
    ensureLibrary(repoKey);
    installLibraryWatchers();
    requestLibrarySync({ minIntervalMs: MOUNT_SYNC_MIN_INTERVAL_MS });
  }, [repoKey]);
  if (snapshot.repoKey === repoKey) return snapshot;
  return { ...getServerLibrarySnapshot(), repoKey };
}

export function useAlbums(repoKey: string): AlbumsSnapshot {
  const snapshot = useSyncExternalStore(subscribeAlbums, getAlbumsSnapshot, getServerAlbumsSnapshot);
  useEffect(() => {
    ensureAlbums(repoKey);
    void loadAlbums();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadAlbums();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [repoKey]);
  if (snapshot.repoKey === repoKey) return snapshot;
  return { ...getServerAlbumsSnapshot(), repoKey };
}

export function useBackupStatus(): BackupSnapshot {
  const snapshot = useSyncExternalStore(subscribeBackup, getBackupSnapshot, getServerBackupSnapshot);
  useEffect(() => {
    startBackupWatcher();
  }, []);
  return snapshot;
}

export function useWebUploadProgress(): WebUploadProgress {
  return useSyncExternalStore(subscribeWebUploads, getWebUploadProgress, getServerWebUploadProgress);
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true
  );
}
