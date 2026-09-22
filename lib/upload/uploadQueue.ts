// Phase 3 upload queue: per-file + per-chunk progress, bounded-concurrency
// chunk uploads with retry/backoff, pause/cancel, and localStorage-backed
// resumability. Replaces the simple sequential loop from Phase 1/2
// (app/upload/page.tsx used to call a single uploadOneFile() directly).
//
// Kept out of scope on purpose (Phase 4/5): IndexedDB, an offline/background
// queue, PWA/service worker. This engine only runs while the tab is open.

import {
  chunkFile,
  blobToBase64,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_UPLOAD_CONCURRENCY,
  type ChunkInfo,
} from "@/lib/chunking";
import { generateThumbnails } from "@/lib/thumbnails";
import { extractVideoMetadata, captureVideoPosterFrame } from "@/lib/media/video";
import { loadFileRecord, saveFileRecord, markChunkUploaded, removeFileRecord } from "./persist";
import type { ChunkTaskState, FileTaskSnapshot, FileUploadStatus } from "./types";

const MAX_CHUNK_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVideo(file: File): boolean {
  return file.type.startsWith("video/");
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

/** Runs `worker` over `items` with at most `limit` concurrent in flight.
 * Stops launching new work (but lets in-flight settle) once `shouldStop()`
 * returns true, and pauses launching new work while `isPaused()` is true. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  opts: { isPaused: () => boolean; isCanceled: () => boolean }
): Promise<void> {
  let cursor = 0;
  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      if (opts.isCanceled()) return;
      while (opts.isPaused() && !opts.isCanceled()) {
        await sleep(200);
      }
      if (opts.isCanceled()) return;
      const item = items[cursor++];
      await worker(item);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
  await Promise.all(runners);
}

class CanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "CanceledError";
  }
}

interface FileTask {
  clientId: string;
  file: File;
  controller: AbortController;
  paused: boolean;
  canceled: boolean;
  snapshot: FileTaskSnapshot;
}

export type QueueListener = (snapshots: FileTaskSnapshot[]) => void;

export class UploadQueue {
  private tasks: FileTask[] = [];
  private listeners = new Set<QueueListener>();
  private concurrency: number;
  private globalPaused = false;

  constructor(concurrency: number = DEFAULT_UPLOAD_CONCURRENCY) {
    this.concurrency = concurrency;
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshots());
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshots();
    for (const l of this.listeners) l(snap);
  }

  private snapshots(): FileTaskSnapshot[] {
    return this.tasks.map((t) => t.snapshot);
  }

  private update(task: FileTask, patch: Partial<FileTaskSnapshot>): void {
    task.snapshot = { ...task.snapshot, ...patch };
    this.emit();
  }

  private updateChunk(task: FileTask, index: number, patch: Partial<ChunkTaskState>): void {
    const chunks = task.snapshot.chunks.map((c) => (c.index === index ? { ...c, ...patch } : c));
    task.snapshot = { ...task.snapshot, chunks };
    this.emit();
  }

  addFiles(files: File[]): void {
    for (const file of files) {
      if (!isImage(file) && !isVideo(file)) continue;
      const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const task: FileTask = {
        clientId,
        file,
        controller: new AbortController(),
        paused: false,
        canceled: false,
        snapshot: {
          clientId,
          filename: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
          status: "queued",
          message: "Queued",
          chunks: [],
          bytesUploaded: 0,
        },
      };
      this.tasks.push(task);
    }
    this.emit();
    this.pump();
  }

  pauseAll(): void {
    this.globalPaused = true;
    for (const t of this.tasks) {
      if (t.snapshot.status === "uploading" || t.snapshot.status === "queued") {
        this.update(t, { status: t.snapshot.status === "uploading" ? "paused" : t.snapshot.status });
      }
    }
  }

  resumeAll(): void {
    this.globalPaused = false;
    for (const t of this.tasks) {
      if (t.snapshot.status === "paused") {
        this.update(t, { status: "uploading" });
      }
    }
    this.pump();
  }

  cancelFile(clientId: string): void {
    const task = this.tasks.find((t) => t.clientId === clientId);
    if (!task) return;
    task.canceled = true;
    task.controller.abort();
    this.update(task, { status: "canceled", message: "Canceled" });
  }

  retryFile(clientId: string): void {
    const task = this.tasks.find((t) => t.clientId === clientId);
    if (!task) return;
    task.canceled = false;
    task.controller = new AbortController();
    this.update(task, { status: "queued", message: "Queued", error: undefined });
    this.pump();
  }

  private isPaused(): boolean {
    return this.globalPaused;
  }

  private async pump(): Promise<void> {
    // Process files one at a time (chunk uploads within a file are what get
    // the concurrency budget) so a single video doesn't starve every other
    // queued item's chance to *start* hashing, while still keeping GitHub
    // API load bounded.
    for (const task of this.tasks) {
      if (task.snapshot.status !== "queued") continue;
      if (this.isPaused()) return;
      // eslint-disable-next-line no-await-in-loop
      await this.processFile(task);
    }
  }

  private async processFile(task: FileTask): Promise<void> {
    const { file } = task;
    const signal = task.controller.signal;
    try {
      this.update(task, { status: "hashing", message: "Hashing & chunking…" });
      const { fileHash, chunkSize, chunks } = await chunkFile(
        file,
        DEFAULT_CHUNK_SIZE,
        (bytesHashed, total) => {
          this.update(task, {
            message: `Hashing… ${Math.round((bytesHashed / total) * 100)}%`,
          });
        }
      );
      if (task.canceled) throw new CanceledError();

      const chunkStates: ChunkTaskState[] = chunks.map((c) => ({
        index: c.index,
        hash: c.hash,
        size: c.size,
        status: "pending",
        attempts: 0,
      }));
      this.update(task, { fileHash, chunks: chunkStates });

      const priorRecord = loadFileRecord(fileHash);
      saveFileRecord({
        fileHash,
        filename: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
        chunkSize,
        chunkHashes: chunks.map((c) => c.hash),
        uploadedChunkHashes: priorRecord?.uploadedChunkHashes ?? [],
        status: "uploading",
        updatedAt: new Date().toISOString(),
      });

      this.update(task, { status: "uploading", message: "Checking which chunks are already stored…" });
      const initRes = await fetch("/api/media/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunkHashes: chunks.map((c) => c.hash) }),
        signal,
      });
      if (!initRes.ok) throw new Error((await initRes.json()).error ?? "init failed");
      const { missing } = (await initRes.json()) as { missing: string[] };
      const missingSet = new Set(missing);

      // Chunks already known-uploaded (server dedup OR our own localStorage
      // record from a prior interrupted attempt on the same file) are
      // marked "skipped" immediately — this is the resume behavior.
      for (const c of chunkStates) {
        if (!missingSet.has(c.hash)) {
          this.updateChunk(task, c.index, { status: "skipped" });
        }
      }
      this.recomputeBytesUploaded(task, chunks);

      const chunkBlobShas: Record<string, string> = {};
      const toUpload = chunks.filter((c) => missingSet.has(c.hash));

      await runWithConcurrency(
        toUpload,
        this.concurrency,
        async (chunk) => {
          if (task.canceled) return;
          this.updateChunk(task, chunk.index, { status: "uploading" });
          const sha = await this.uploadChunkWithRetry(task, chunk, signal);
          chunkBlobShas[chunk.hash] = sha;
          this.updateChunk(task, chunk.index, { status: "done" });
          markChunkUploaded(fileHash, chunk.hash);
          this.recomputeBytesUploaded(task, chunks);
        },
        {
          isPaused: () => this.isPaused() || task.paused,
          isCanceled: () => task.canceled,
        }
      );

      if (task.canceled) throw new CanceledError();

      this.update(task, { status: "processing", message: "Reading metadata…" });
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;
      let posterSource: File | Blob = file;

      if (isVideo(file)) {
        const meta = await extractVideoMetadata(file);
        width = meta.width;
        height = meta.height;
        duration = meta.duration;
        this.update(task, { message: "Capturing poster frame…" });
        posterSource = await captureVideoPosterFrame(file);
      } else {
        const dims = await getImageDimensions(file);
        width = dims.width;
        height = dims.height;
      }

      this.update(task, { message: "Generating thumbnails…" });
      const thumbnails = await generateThumbnails(posterSource);

      const id = `media_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      this.update(task, { mediaId: id, message: "Uploading thumbnails…" });

      const thumbnailBlobShas: Record<string, string> = {};
      const thumbnailPaths: Record<string, string> = {};
      for (const thumb of thumbnails) {
        if (task.canceled) throw new CanceledError();
        const base64Content = await blobToBase64(thumb.blob);
        const res = await fetch("/api/media/upload/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hash: `thumb-${id}-${thumb.size}`, base64Content }),
          signal,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "thumbnail upload failed");
        const { sha } = (await res.json()) as { sha: string };
        thumbnailBlobShas[String(thumb.size)] = sha;
        thumbnailPaths[String(thumb.size)] = `thumbnails/${id}/${thumb.size}.webp`;
      }

      const record = {
        id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        createdAt: new Date().toISOString(),
        width,
        height,
        duration,
        hash: `sha256:${fileHash}`,
        chunkSize,
        chunks: chunks.map((c) => ({
          index: c.index,
          hash: c.hash,
          path: `objects/${c.hash.slice(0, 2)}/${c.hash}`,
        })),
        thumbnails: thumbnailPaths,
        deletedAt: null,
      };

      this.update(task, { status: "committing", message: "Committing metadata + manifest…" });
      const commitRes = await fetch("/api/media/upload/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ record, chunkBlobShas, thumbnailBlobShas }),
        signal,
      });
      if (!commitRes.ok) throw new Error((await commitRes.json()).error ?? "commit failed");

      removeFileRecord(fileHash);
      this.update(task, { status: "done", message: "Done" });
    } catch (err) {
      if (err instanceof CanceledError || task.canceled) {
        this.update(task, { status: "canceled", message: "Canceled" });
        return;
      }
      this.update(task, { status: "error", message: "Failed", error: String(err) });
    }
  }

  private recomputeBytesUploaded(task: FileTask, chunks: ChunkInfo[]): void {
    const doneOrSkipped = new Set(
      task.snapshot.chunks
        .filter((c) => c.status === "done" || c.status === "skipped")
        .map((c) => c.index)
    );
    const bytes = chunks
      .filter((c) => doneOrSkipped.has(c.index))
      .reduce((sum, c) => sum + c.size, 0);
    this.update(task, { bytesUploaded: bytes });
  }

  private async uploadChunkWithRetry(
    task: FileTask,
    chunk: ChunkInfo,
    signal: AbortSignal
  ): Promise<string> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1;
      this.updateChunk(task, chunk.index, { attempts: attempt });
      try {
        const base64Content = await blobToBase64(chunk.blob);
        const res = await fetch("/api/media/upload/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hash: chunk.hash, base64Content }),
          signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `chunk upload failed (${res.status})`);
        }
        const { sha } = (await res.json()) as { sha: string };
        return sha;
      } catch (err) {
        if (signal.aborted || task.canceled) throw new CanceledError();
        if (attempt >= MAX_CHUNK_ATTEMPTS) {
          this.updateChunk(task, chunk.index, { status: "error" });
          throw err instanceof Error ? err : new Error(String(err));
        }
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(delay);
      }
    }
  }
}
