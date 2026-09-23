// Bridge to the native PhotoWatcher Capacitor plugin (apps/mobile/android/
// .../photowatcher/PhotoWatcherPlugin.java). This file ships to Vercel as
// part of the same Next.js bundle as the plain PWA, so every native call in
// here must be a safe no-op in a normal browser and must never run during
// SSR — everything is gated behind isNativeAndroid().
//
// registerPlugin() itself is safe to call at module scope in any
// environment (SSR included): it only builds a proxy object against
// globalThis and never touches the DOM. What's NOT safe outside native
// Android is calling any method on that proxy — with no 'web' fallback
// implementation supplied, Capacitor throws on web/SSR, which is exactly
// why every call site below checks isNativeAndroid() first.

import { registerPlugin, Capacitor, type PluginListenerHandle } from "@capacitor/core";
import type { UploadQueue } from "./uploadQueue";

export interface NewAssetEvent {
  uri: string;
  displayName: string | null;
  mimeType: string;
}

interface PhotoWatcherStatus {
  enabled: boolean;
}

interface ReadAssetResult {
  data: string; // base64-encoded bytes
  mimeType: string;
}

interface PhotoWatcherPluginApi {
  start(): Promise<PhotoWatcherStatus>;
  stop(): Promise<PhotoWatcherStatus>;
  getStatus(): Promise<PhotoWatcherStatus>;
  readAsset(options: { uri: string }): Promise<ReadAssetResult>;
  addListener(
    eventName: "newAsset",
    listenerFunc: (event: NewAssetEvent) => void
  ): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

const PhotoWatcher = registerPlugin<PhotoWatcherPluginApi>("PhotoWatcher");

let removeNewAssetListener: (() => void) | null = null;
// The queue currently bound to native events, read at delivery time rather
// than captured once in the addListener closure below. Without this, once
// the native listener was registered against a given UploadQueue instance,
// a later startPhotoWatcher(differentQueue) call (e.g. after the upload
// page unmounts/remounts and creates a fresh queue) would be silently
// ignored — new assets would keep flowing to the stale/disposed queue
// because `if (!removeNewAssetListener)` skips re-registration entirely.
let currentQueue: UploadQueue | null = null;

/** True only inside the sideloaded Android app's Capacitor WebView — false
 * on Vercel, in any desktop/mobile browser, and during SSR (no `window`). */
export function isNativeAndroid(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function handleNewAsset(event: NewAssetEvent): Promise<void> {
  // Read the currently-bound queue at delivery time (not whatever queue was
  // passed to startPhotoWatcher() when the native listener was first
  // registered) so a later call with a different UploadQueue instance takes
  // effect immediately without needing to tear down/re-add the listener.
  const queue = currentQueue;
  if (!queue) {
    console.error("[404gb] received a native asset with no upload queue bound; dropping", event);
    return;
  }
  const { data, mimeType } = await PhotoWatcher.readAsset({ uri: event.uri });
  const bytes = base64ToUint8Array(data);
  const filename = event.displayName || event.uri.split("/").pop() || `asset-${Date.now()}`;
  // Reuses the existing chunked/resumable upload queue exactly as-is — a
  // native asset becomes a File the same way a manually-picked one would.
  // (The `as BlobPart` cast works around TS's dom lib typing Uint8Array's
  // buffer as ArrayBufferLike | SharedArrayBuffer, which BlobPart's type
  // doesn't accept even though a Uint8Array is always a valid BlobPart at
  // runtime.)
  const file = new File([bytes as BlobPart], filename, { type: mimeType || event.mimeType });
  queue.addFiles([file]);
}

/**
 * Registers the 'newAsset' listener (each event's bytes are fetched via
 * readAsset() and handed to `queue.addFiles([file])`, so they flow through
 * the exact same upload path as a manual selection) and starts the native
 * watcher. Safe no-op outside native Android.
 *
 * Safe to call more than once (e.g. the upload page remounts with a fresh
 * UploadQueue instance): each call rebinds `currentQueue` even if the
 * native listener itself was already registered by an earlier call.
 */
export async function startPhotoWatcher(queue: UploadQueue): Promise<void> {
  if (!isNativeAndroid()) return;

  currentQueue = queue;

  if (!removeNewAssetListener) {
    const handle = await PhotoWatcher.addListener("newAsset", (event) => {
      handleNewAsset(event).catch((err) => {
        console.error("[404gb] failed to hand off a native asset to the upload queue", err);
      });
    });
    removeNewAssetListener = () => {
      handle.remove();
    };
  }

  await PhotoWatcher.start();
}

/** Safe no-op outside native Android. */
export async function stopPhotoWatcher(): Promise<void> {
  if (!isNativeAndroid()) return;
  await PhotoWatcher.stop();
}

/** Resolves false outside native Android. */
export async function getPhotoWatcherStatus(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  const status = await PhotoWatcher.getStatus();
  return status.enabled;
}
