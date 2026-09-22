// localStorage-backed resumability record (Phase 3). Keyed by whole-file
// hash so re-selecting the same file after a reload finds its prior state.
// This does NOT store file bytes — only which chunk hashes are believed
// already uploaded, so the queue can skip re-uploading them (the server-side
// /api/media/upload/init dedup check is the real safety net; this is just
// an optimization + a way to show "resumed" in the UI without needing
// IndexedDB, which is Phase 4 scope).

import type { PersistedFileRecord } from "./types";

const STORAGE_KEY = "404gb:uploadQueue:v1";

type StoredMap = Record<string, PersistedFileRecord>;

function readAll(): StoredMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredMap;
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage full/unavailable — resumability is best-effort, never
    // block the upload on it.
  }
}

export function loadFileRecord(fileHash: string): PersistedFileRecord | null {
  return readAll()[fileHash] ?? null;
}

export function saveFileRecord(record: PersistedFileRecord): void {
  const all = readAll();
  all[record.fileHash] = record;
  writeAll(all);
}

export function markChunkUploaded(fileHash: string, chunkHash: string): void {
  const all = readAll();
  const record = all[fileHash];
  if (!record) return;
  if (!record.uploadedChunkHashes.includes(chunkHash)) {
    record.uploadedChunkHashes.push(chunkHash);
  }
  record.updatedAt = new Date().toISOString();
  writeAll(all);
}

export function removeFileRecord(fileHash: string): void {
  const all = readAll();
  delete all[fileHash];
  writeAll(all);
}

export function listFileRecords(): PersistedFileRecord[] {
  return Object.values(readAll());
}
