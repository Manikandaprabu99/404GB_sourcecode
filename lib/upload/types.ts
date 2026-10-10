// Shared types for the Phase 3 upload queue (lib/upload/uploadQueue.ts).

export type FileUploadStatus =
  | "queued"
  | "hashing"
  | "uploading"
  | "processing" // thumbnails/poster generation
  | "committing"
  | "done"
  | "duplicate" // same whole-file hash is already in the library; nothing uploaded
  | "error"
  | "canceled"
  | "paused";

export interface AddFilesOptions {
  /** Original media id when this file is an edited copy of it. */
  editedFrom?: string;
  /** Capture time (ISO 8601) to record instead of reading it from the file. */
  takenAt?: string;
}

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
  /** Existing media id when status is "duplicate". */
  duplicateOf?: string;
}

/** Uploaded-but-uncommitted blobs for one file (lib/upload/persist.ts), reused on retry or reload. */
export interface PersistedFileRecord {
  fileHash: string;
  filename: string;
  size: number;
  /** Git blob sha per chunk hash. */
  chunkBlobShas: Record<string, string>;
  updatedAt: string;
}
