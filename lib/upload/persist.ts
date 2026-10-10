// Best-effort localStorage memory of uploaded-but-uncommitted chunk blobs, per file hash, for resuming.

import type { PersistedFileRecord } from "./types";

const STORAGE_KEY = "404gb:uploadProgress:v2";
const LEGACY_KEYS = ["404gb:uploadQueue:v1"];
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECORDS = 40;

type StoredMap = Record<string, PersistedFileRecord>;

let legacyCleared = false;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): StoredMap {
  const store = storage();
  if (!store) return {};
  try {
    if (!legacyCleared) {
      legacyCleared = true;
      for (const key of LEGACY_KEYS) store.removeItem(key);
    }
    const raw = store.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: StoredMap): void {
  const store = storage();
  if (!store) return;
  const now = Date.now();
  const kept = Object.values(map)
    .filter((record) => now - Date.parse(record.updatedAt) < MAX_AGE_MS)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_RECORDS);
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept.map((r) => [r.fileHash, r]))));
  } catch {
    // Storage full or disabled: resuming just re-uploads.
  }
}

/** Blob shas of this file's already-uploaded chunks, keyed by chunk hash. */
export function loadChunkShas(fileHash: string): Record<string, string> {
  const record = readAll()[fileHash];
  return record && record.chunkBlobShas && typeof record.chunkBlobShas === "object"
    ? { ...record.chunkBlobShas }
    : {};
}

export function rememberChunkSha(
  fileHash: string,
  chunkHash: string,
  blobSha: string,
  file: { filename: string; size: number }
): void {
  const all = readAll();
  const record = all[fileHash] ?? {
    fileHash,
    filename: file.filename,
    size: file.size,
    chunkBlobShas: {},
    updatedAt: "",
  };
  record.chunkBlobShas = { ...record.chunkBlobShas, [chunkHash]: blobSha };
  record.updatedAt = new Date().toISOString();
  all[fileHash] = record;
  writeAll(all);
}

/** Drops the record once the file is committed (or its shas proved stale). */
export function forgetFileProgress(fileHash: string): void {
  const all = readAll();
  if (!(fileHash in all)) return;
  delete all[fileHash];
  writeAll(all);
}

export function listFileRecords(): PersistedFileRecord[] {
  return Object.values(readAll());
}
