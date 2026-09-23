"use client";

// Only ever renders inside the sideloaded Android app (see isNativeAndroid
// in lib/upload/nativeWatcher.ts) — null everywhere else, including on
// first client render before the mount effect has run, so the deployed
// Vercel PWA and a desktop browser never show this and never hydrate-
// mismatch on it.

import { useEffect, useState } from "react";
import type { UploadQueue } from "@/lib/upload/uploadQueue";
import {
  getPhotoWatcherStatus,
  isNativeAndroid,
  startPhotoWatcher,
  stopPhotoWatcher,
} from "@/lib/upload/nativeWatcher";

export default function AutoBackupToggle({ queue }: { queue: UploadQueue }) {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const native = isNativeAndroid();
    setSupported(native);
    if (!native) return;

    getPhotoWatcherStatus()
      .then((isEnabled) => {
        setEnabled(isEnabled);
        // The native side persists "enabled" across app restarts and page
        // remounts, but the JS-side listener binding (lib/upload/
        // nativeWatcher.ts) doesn't — it lives only in this module's
        // in-memory state. If watching is already on, rebind it to *this*
        // mount's `queue` so a remounted page (fresh UploadQueue instance)
        // doesn't leave native events flowing to a stale/disposed queue.
        if (isEnabled) {
          startPhotoWatcher(queue).catch((err) => {
            console.error("[404gb] failed to rebind auto-backup queue", err);
          });
        }
      })
      .catch(() => {
        /* leave as false — reflects "off" until the user toggles it */
      });
  }, [queue]);

  if (!mounted || !supported) return null;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (enabled) {
        await stopPhotoWatcher();
        setEnabled(false);
      } else {
        await startPhotoWatcher(queue);
        setEnabled(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3.5 text-body">
      <div>
        <p className="font-medium text-ink">Auto-backup camera roll</p>
        <p className="text-small text-ink-muted">
          {enabled
            ? "Watching for new photos & videos in the background"
            : "Off — new photos/videos won't upload automatically"}
        </p>
        {error && <p className="mt-1 text-small text-danger">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={busy}
        onClick={toggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-180 ease-out-expo ${
          enabled ? "bg-accent" : "bg-surface-3"
        } ${busy ? "opacity-50" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform duration-180 ease-spring ${
            enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
