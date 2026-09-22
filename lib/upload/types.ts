// Shared types for the Phase 3 upload queue (lib/upload/uploadQueue.ts).

export type FileUploadStatus =
  | "queued"
  | "hashing"
  | "uploading"
  | "processing" // thumbnails/poster generation
  | "committing"
  | "done"
  | "error"
  | "canceled"
  | "paused";

export type ChunkUploadStatus = "pending" | "uploading" | "done" | "error" | "skipped";

export interface ChunkTaskState {
  index: number;
  hash: string;
  size: number;
  status: ChunkUploadStatus;
  attempts: number;
}

export interface FileTaskSnapshot {
  clientId: string; // stable id for this queue entry (per add, not per hash)
  filename: string;
  size: number;
  mimeType: string;
  status: FileUploadStatus;
  message: string;
  error?: string;
  fileHash?: string;
  chunks: ChunkTaskState[];
  bytesUploaded: number;
  mediaId?: string;
}

/** What gets persisted to localStorage, keyed by whole-file hash, so a page
 * reload can recognize "this file was already (partly) uploaded" and the
 * chunk-level dedup check (/api/media/upload/init) skips re-sending bytes
 * for chunks that made it through. Raw file bytes are never persisted here
 * (that needs IndexedDB — Phase 4); this is status bookkeeping only. */
export interface PersistedFileRecord {
  fileHash: string;
  filename: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  chunkHashes: string[];
  uploadedChunkHashes: string[];
  status: FileUploadStatus;
  mediaId?: string;
  updatedAt: string;
}
