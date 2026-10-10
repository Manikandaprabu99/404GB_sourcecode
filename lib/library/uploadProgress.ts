// "Uploading 2 of 5" for browser uploads, derived from the app-wide queue. A
// batch is every file added since the queue was last completely idle.

import { getUploadQueue } from "@/lib/upload/queueSingleton";
import type { FileTaskSnapshot, FileUploadStatus } from "@/lib/upload/types";

export interface WebUploadProgress {
  active: boolean;
  /** 1-based number of the file being uploaded. */
  current: number;
  total: number;
  /** 0..1 by bytes. */
  fraction: number;
  /** Every remaining file is paused (offline or paused by the user). */
  paused: boolean;
}

const IDLE: WebUploadProgress = { active: false, current: 0, total: 0, fraction: 0, paused: false };

const ACTIVE = new Set<FileUploadStatus>([
  "queued",
  "hashing",
  "uploading",
  "processing",
  "committing",
  "paused",
]);

let snapshot: WebUploadProgress = IDLE;
let batch = new Set<string>();
let unsubscribeQueue: (() => void) | null = null;
const listeners = new Set<() => void>();

function compute(tasks: FileTaskSnapshot[]): WebUploadProgress {
  const active = tasks.filter((task) => ACTIVE.has(task.status));
  if (active.length === 0) {
    batch = new Set();
    return IDLE;
  }
  if (batch.size === 0) batch = new Set(active.map((task) => task.clientId));
  else for (const task of active) batch.add(task.clientId);

  let finished = 0;
  let total = 0;
  let bytesDone = 0;
  let bytesTotal = 0;
  for (const task of tasks) {
    if (!batch.has(task.clientId)) continue;
    total += 1;
    bytesTotal += task.size;
    if (ACTIVE.has(task.status)) {
      bytesDone += Math.min(task.bytesUploaded, task.size);
    } else {
      finished += 1;
      bytesDone += task.size;
    }
  }
  return {
    active: true,
    current: Math.min(finished + 1, total),
    total,
    fraction: bytesTotal > 0 ? bytesDone / bytesTotal : finished / Math.max(1, total),
    paused: active.every((task) => task.status === "paused"),
  };
}

function same(a: WebUploadProgress, b: WebUploadProgress): boolean {
  return (
    a.active === b.active &&
    a.current === b.current &&
    a.total === b.total &&
    a.paused === b.paused &&
    Math.round(a.fraction * 200) === Math.round(b.fraction * 200)
  );
}

export function subscribeWebUploads(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribeQueue && typeof window !== "undefined") {
    unsubscribeQueue = getUploadQueue().subscribe((tasks) => {
      const next = compute(tasks);
      if (same(next, snapshot)) return;
      snapshot = next;
      for (const l of listeners) l();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeQueue) {
      unsubscribeQueue();
      unsubscribeQueue = null;
    }
  };
}

export function getWebUploadProgress(): WebUploadProgress {
  return snapshot;
}

export function getServerWebUploadProgress(): WebUploadProgress {
  return IDLE;
}
