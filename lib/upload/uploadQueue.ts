// App-wide upload queue: one file at a time, bounded chunk concurrency, waits out pause/offline/rate limits.
// Every step talks to GitHub directly (lib/media): dedup check, chunk and thumbnail blobs, one commit.

import {
  chunkFile,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_UPLOAD_CONCURRENCY,
  sha256Hex,
  type ChunkInfo,
} from "@/lib/chunking";
import { ApiError, withRepo } from "@/lib/library/api";
import {
  checkUpload,
  commitMediaUpload,
  setTakenAtIfMissing,
  uploadBlob,
  type CommitUploadResult,
  type UploadCheck,
} from "@/lib/media";
import { makeMediaId, type MediaRecord } from "@/lib/media/types";
import { captureVideoPosterFrame, extractVideoMetadata } from "@/lib/media/video";
import { generateThumbnails } from "@/lib/thumbnails";
import { probeImageDimensions } from "@/lib/thumbnails/imageDimensions";
import { readCaptureDate } from "./captureDate";
import { mediaMimeType } from "./mimeType";
import { forgetFileProgress, loadChunkShas, rememberChunkSha } from "./persist";
import type {
  AddFilesOptions,
  ChunkTaskState,
  ChunkUploadStatus,
  FileTaskSnapshot,
  FileUploadStatus,
} from "./types";

// Shown as-is by the upload screen, so no technical jargon.
const MESSAGES = {
  waiting: "Waiting",
  preparing: "Preparing…",
  uploading: "Uploading…",
  finishing: "Finishing…",
  done: "Done",
  duplicate: "Already in your library",
  failed: "Couldn't upload",
  canceled: "Canceled",
} as const;

type BlockReason = "paused" | "offline" | "rate-limit";

const BLOCKED_MESSAGES: Record<BlockReason, string> = {
  paused: "Paused",
  offline: "Offline — will resume automatically",
  "rate-limit": "Waiting — GitHub rate limit",
};

const MAX_REQUEST_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 3 * 60 * 1000;
const MAX_BACKOFF_MS = 30_000;
const OFFLINE_POLL_MS = 3000;
const DEFAULT_RATE_LIMIT_WAIT_S = 60;
const MAX_RATE_LIMIT_WAIT_S = 3600;
const HASH_PROGRESS_MIN_BYTES = 64 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 20_000;
const THUMBNAIL_TIMEOUT_MS = 30_000;
const CAPTURE_DATE_TIMEOUT_MS = 10_000;
const MAX_FINISHED_TASKS = 200;

class CanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "CanceledError";
  }
}

/** A failure whose message is fit to show the user. */
class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
  }
}

/** A non-retryable refusal (bad input, missing parts…), with the library's code and details. */
class ApiResponseError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(err: ApiError) {
    super(err.message || `GitHub refused the upload (${err.status})`);
    this.name = "ApiResponseError";
    this.status = err.status;
    this.code = err.code;
    this.details = err.details;
  }
}

/** Best effort: an older copy without a capture date gets this file's, so it sorts by when it was taken. */
function fillMissingCaptureDate(mediaId: string, takenAt: string): void {
  void withRepo((repo) => setTakenAtIfMissing(repo, mediaId, takenAt)).catch(() => {});
}

/** A finished commit, with the library ("owner/repo") it went into. */
export type CommittedUpload = CommitUploadResult & { repoKey: string };

interface CommitBody {
  record: MediaRecord;
  chunkBlobShas: Record<string, string>;
  thumbnailBlobShas: Record<string, string>;
}

interface FileTask {
  clientId: string;
  /** Released once the file is safely in the library. */
  file: File | null;
  mimeType: string;
  options: AddFilesOptions;
  controller: AbortController;
  state: "waiting" | "active" | "finished";
  /** What an active task shows while the queue isn't blocked. */
  phase: { status: FileUploadStatus; message: string };
  snapshot: FileTaskSnapshot;
}

export type QueueListener = (snapshots: FileTaskSnapshot[]) => void;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function rateLimitSeconds(retryAfterSec: number | undefined): number {
  const seconds = retryAfterSec !== undefined && Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? retryAfterSec
    : DEFAULT_RATE_LIMIT_WAIT_S;
  return Math.min(MAX_RATE_LIMIT_WAIT_S, Math.ceil(seconds));
}

async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

function normalizeIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function describeFailure(err: unknown): string {
  if (err instanceof UploadError || err instanceof ApiResponseError) return err.message;
  return "Something went wrong — try again";
}

function newClientId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const done = (width: number, height: number) => {
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onload = () => done(img.naturalWidth, img.naturalHeight);
    img.onerror = () => done(0, 0);
    img.src = url;
  });
}

export class UploadQueue {
  private tasks: FileTask[] = [];
  private readonly listeners = new Set<QueueListener>();
  private readonly committedListeners = new Set<(upload: CommittedUpload) => void>();
  private readonly waiters = new Set<() => void>();
  private readonly concurrency: number;
  private running = false;
  private userPaused = false;
  private offline = false;
  private rateLimitedUntil = 0;
  private blocked: BlockReason | null = null;

  constructor(concurrency: number = DEFAULT_UPLOAD_CONCURRENCY) {
    this.concurrency = Math.max(1, concurrency);
    if (typeof window !== "undefined") {
      this.offline = typeof navigator !== "undefined" && navigator.onLine === false;
      this.blocked = this.blockedReason();
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", this.handleOffline);
    }
  }

  /** Detaches the online/offline listeners; optional, since waits also poll navigator.onLine. */
  dispose(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
  }

  private handleOnline = (): void => {
    this.offline = false;
    this.refreshBlocked();
    this.kick();
  };

  private handleOffline = (): void => {
    this.offline = true;
    this.refreshBlocked();
  };

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshots());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshots(): FileTaskSnapshot[] {
    return this.snapshots();
  }

  /** Called after each new item is committed (not for duplicates), e.g. to show it in the library at once. */
  onCommitted(listener: (upload: CommittedUpload) => void): () => void {
    this.committedListeners.add(listener);
    return () => {
      this.committedListeners.delete(listener);
    };
  }

  /** Queues files for upload and returns their queue ids (non-media files are skipped). */
  addFiles(files: File[], options: AddFilesOptions = {}): string[] {
    const added: string[] = [];
    for (const file of files) {
      const mimeType = mediaMimeType(file);
      if (!mimeType) continue;
      const task = this.createTask(newClientId(), file, mimeType, { ...options });
      this.tasks.push(task);
      added.push(task.clientId);
    }
    if (added.length > 0) {
      this.emit();
      this.kick();
    }
    return added;
  }

  pauseAll(): void {
    this.userPaused = true;
    this.refreshBlocked();
  }

  resumeAll(): void {
    this.userPaused = false;
    this.refreshBlocked();
    this.kick();
  }

  /** Cancels a waiting or running file; on a failed file it dismisses the error. */
  cancelFile(clientId: string): void {
    const task = this.tasks.find((t) => t.clientId === clientId);
    if (!task) return;
    if (task.state === "finished") {
      if (task.snapshot.status === "error") {
        task.snapshot = { ...task.snapshot, status: "canceled", message: MESSAGES.canceled };
        this.emit();
      }
      return;
    }
    task.controller.abort();
    this.finish(task, { status: "canceled", message: MESSAGES.canceled });
  }

  retryFile(clientId: string): void {
    const index = this.tasks.findIndex((t) => t.clientId === clientId);
    const old = this.tasks[index];
    if (!old || old.state !== "finished" || !old.file) return;
    if (old.snapshot.status !== "error" && old.snapshot.status !== "canceled") return;
    // A fresh task object, so a canceled run that's still unwinding can't touch the new one.
    this.tasks[index] = this.createTask(old.clientId, old.file, old.mimeType, old.options);
    this.emit();
    this.kick();
  }

  /** Removes finished entries (done, already in library, canceled) from the list. */
  clearFinished(): void {
    const remaining = this.tasks.filter((t) => t.state !== "finished" || t.snapshot.status === "error");
    if (remaining.length === this.tasks.length) return;
    this.tasks = remaining;
    this.emit();
  }

  private createTask(clientId: string, file: File, mimeType: string, options: AddFilesOptions): FileTask {
    const task: FileTask = {
      clientId,
      file,
      mimeType,
      options,
      controller: new AbortController(),
      state: "waiting",
      phase: { status: "queued", message: MESSAGES.waiting },
      snapshot: {
        clientId,
        filename: file.name,
        size: file.size,
        mimeType,
        status: "queued",
        message: MESSAGES.waiting,
        chunks: [],
        bytesUploaded: 0,
      },
    };
    task.snapshot = { ...task.snapshot, ...this.display(task) };
    return task;
  }

  private snapshots(): FileTaskSnapshot[] {
    return this.tasks.map((t) => t.snapshot);
  }

  private emit(): void {
    const snapshots = this.snapshots();
    for (const listener of this.listeners) listener(snapshots);
  }

  private blockedReason(): BlockReason | null {
    if (this.userPaused) return "paused";
    if (this.offline) return "offline";
    if (Date.now() < this.rateLimitedUntil) return "rate-limit";
    return null;
  }

  private display(task: FileTask): Pick<FileTaskSnapshot, "status" | "message"> {
    if (this.blocked) return { status: "paused", message: BLOCKED_MESSAGES[this.blocked] };
    if (task.state === "waiting") return { status: "queued", message: MESSAGES.waiting };
    return task.phase;
  }

  /** On a pause/offline/rate-limit change: refresh every unfinished task and wake waiting requests. */
  private refreshBlocked(): void {
    const reason = this.blockedReason();
    if (reason === this.blocked) return;
    this.blocked = reason;
    for (const task of this.tasks) {
      if (task.state !== "finished") task.snapshot = { ...task.snapshot, ...this.display(task) };
    }
    this.emit();
    for (const wake of Array.from(this.waiters)) wake();
  }

  /** Resolves on the next block-state change, on abort, or after `timeoutMs`. */
  private waitForChange(signal: AbortSignal, timeoutMs?: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      if (signal.aborted) return resolve();
      this.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
      if (timeoutMs !== undefined) timer = setTimeout(done, Math.max(0, timeoutMs));
    });
  }

  private async waitWhileBlocked(task: FileTask): Promise<void> {
    for (;;) {
      if (this.offline && typeof navigator !== "undefined" && navigator.onLine) this.offline = false;
      this.refreshBlocked();
      if (!this.blocked || task.controller.signal.aborted) return;
      const timeout =
        this.blocked === "rate-limit"
          ? this.rateLimitedUntil - Date.now() + 50
          : this.blocked === "offline"
            ? OFFLINE_POLL_MS
            : undefined;
      await this.waitForChange(task.controller.signal, timeout);
    }
  }

  private throwIfCanceled(task: FileTask): void {
    if (task.controller.signal.aborted) throw new CanceledError();
  }

  private update(task: FileTask, patch: Partial<FileTaskSnapshot>): void {
    if (task.state === "finished") return;
    task.snapshot = { ...task.snapshot, ...patch, ...this.display(task) };
    this.emit();
  }

  private setPhase(task: FileTask, status: FileUploadStatus, message: string): void {
    task.phase = { status, message };
    this.update(task, {});
  }

  private finish(
    task: FileTask,
    patch: Partial<FileTaskSnapshot> & Pick<FileTaskSnapshot, "status" | "message">
  ): void {
    if (task.state === "finished") return;
    task.state = "finished";
    if (patch.status === "done" || patch.status === "duplicate") task.file = null;
    task.snapshot = { ...task.snapshot, ...patch };
    this.emit();
  }

  private setChunkStatus(task: FileTask, pick: (chunk: ChunkTaskState) => ChunkUploadStatus | undefined): void {
    const chunks = task.snapshot.chunks.map((chunk) => {
      const status = pick(chunk);
      return status && status !== chunk.status ? { ...chunk, status } : chunk;
    });
    const bytesUploaded = chunks.reduce(
      (sum, chunk) => (chunk.status === "done" || chunk.status === "skipped" ? sum + chunk.size : sum),
      0
    );
    this.update(task, { chunks, bytesUploaded });
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    void this.drain().finally(() => {
      this.running = false;
      // Files added while the runner was finishing must not be left behind.
      if (this.tasks.some((t) => t.state === "waiting")) this.kick();
      else this.pruneFinished();
    });
  }

  private async drain(): Promise<void> {
    for (;;) {
      const task = this.tasks.find((t) => t.state === "waiting");
      if (!task) return;
      await this.waitWhileBlocked(task);
      if (task.state === "waiting") await this.processFile(task);
    }
  }

  private pruneFinished(): void {
    const finished = this.tasks.filter(
      (t) => t.state === "finished" && (t.snapshot.status === "done" || t.snapshot.status === "duplicate")
    );
    const excess = finished.length - MAX_FINISHED_TASKS;
    if (excess <= 0) return;
    const dropped = new Set(finished.slice(0, excess));
    this.tasks = this.tasks.filter((t) => !dropped.has(t));
    this.emit();
  }

  private async processFile(task: FileTask): Promise<void> {
    const file = task.file;
    if (!file) return;
    task.state = "active";
    try {
      this.setPhase(task, "hashing", MESSAGES.preparing);
      const [{ fileHash, chunkSize, chunks }, takenAt] = await Promise.all([
        chunkFile(file, DEFAULT_CHUNK_SIZE, (done, total) => this.reportPreparing(task, done, total)),
        this.captureDate(task, file),
      ]);
      this.throwIfCanceled(task);
      this.update(task, {
        fileHash,
        chunks: chunks.map((c): ChunkTaskState => ({
          index: c.index,
          hash: c.hash,
          size: c.size,
          status: "pending",
          attempts: 0,
        })),
      });

      const init = await this.request<UploadCheck>(task, () =>
        withRepo((repo) => checkUpload(repo, chunks.map((c) => c.hash), fileHash))
      );
      if (init.duplicateOf) {
        this.finishDuplicate(task, init.duplicateOf, fileHash);
        if (init.duplicateNeedsDate && takenAt) fillMissingCaptureDate(init.duplicateOf, takenAt);
        return;
      }

      const missing = new Set(init.missing);
      const remembered = loadChunkShas(fileHash);
      const chunkBlobShas: Record<string, string> = {};
      const reused = new Set<string>();
      for (const hash of missing) {
        if (!remembered[hash]) continue;
        chunkBlobShas[hash] = remembered[hash];
        reused.add(hash);
      }
      this.setChunkStatus(task, (c) => (!missing.has(c.hash) || reused.has(c.hash) ? "skipped" : undefined));

      this.setPhase(task, "uploading", MESSAGES.uploading);
      const toUpload = chunks.filter((c) => missing.has(c.hash) && !chunkBlobShas[c.hash]);
      await this.uploadChunks(task, fileHash, toUpload, chunkBlobShas);

      this.setPhase(task, "processing", MESSAGES.finishing);
      const id = makeMediaId();
      const meta = await this.readMediaMeta(file, task.mimeType);
      const thumbnailBlobShas = await this.uploadThumbnails(task, file);
      const thumbnails: Record<string, string> = {};
      for (const size of Object.keys(thumbnailBlobShas)) thumbnails[size] = `thumbnails/${id}/${size}.webp`;

      const record: MediaRecord = {
        id,
        filename: file.name,
        mimeType: task.mimeType,
        size: file.size,
        createdAt: new Date().toISOString(),
        takenAt,
        ...meta,
        hash: `sha256:${fileHash}`,
        chunkSize,
        chunks: chunks.map((c) => ({ index: c.index, hash: c.hash, path: `objects/${c.hash.slice(0, 2)}/${c.hash}` })),
        thumbnails,
        editedFrom: task.options.editedFrom,
        source: "web",
        deletedAt: null,
      };

      this.setPhase(task, "committing", MESSAGES.finishing);
      const result = await this.commit(task, { record, chunkBlobShas, thumbnailBlobShas }, { fileHash, chunks, reused });
      forgetFileProgress(fileHash);
      if (result.duplicate) {
        this.finishDuplicate(task, result.id, fileHash);
      } else {
        this.finish(task, { status: "done", message: MESSAGES.done, mediaId: result.id, bytesUploaded: file.size });
        for (const listener of this.committedListeners) listener(result);
      }
    } catch (err) {
      if (err instanceof CanceledError || task.controller.signal.aborted) {
        this.finish(task, { status: "canceled", message: MESSAGES.canceled });
      } else {
        this.finish(task, { status: "error", message: MESSAGES.failed, error: describeFailure(err) });
      }
    }
  }

  private finishDuplicate(task: FileTask, existingId: string, fileHash: string): void {
    forgetFileProgress(fileHash);
    this.finish(task, {
      status: "duplicate",
      message: MESSAGES.duplicate,
      duplicateOf: existingId,
      bytesUploaded: task.snapshot.size,
    });
  }

  private reportPreparing(task: FileTask, done: number, total: number): void {
    if (total < HASH_PROGRESS_MIN_BYTES) return;
    const message = `${MESSAGES.preparing} ${Math.floor((done / total) * 100)}%`;
    if (task.phase.message !== message) this.setPhase(task, "hashing", message);
  }

  private async captureDate(task: FileTask, file: File): Promise<string | undefined> {
    const given = normalizeIso(task.options.takenAt);
    if (given) return given;
    try {
      return await withTimeout(readCaptureDate(file), CAPTURE_DATE_TIMEOUT_MS);
    } catch {
      return file.lastModified > 0 ? new Date(file.lastModified).toISOString() : undefined;
    }
  }

  private async readMediaMeta(
    file: File,
    mimeType: string
  ): Promise<Pick<MediaRecord, "width" | "height" | "duration">> {
    if (mimeType.startsWith("video/")) {
      const meta = await withTimeout(extractVideoMetadata(file), METADATA_TIMEOUT_MS).catch(() => null);
      return {
        width: meta?.width || undefined,
        height: meta?.height || undefined,
        duration: meta && meta.duration > 0 ? meta.duration : undefined,
      };
    }
    const decoded = await withTimeout(getImageDimensions(file), METADATA_TIMEOUT_MS).catch(() => null);
    const dims = decoded && decoded.width > 0 ? decoded : await probeImageDimensions(file);
    return { width: dims?.width || undefined, height: dims?.height || undefined };
  }

  /** Best-effort previews: on failure the file still uploads (the gallery retries images it can decode later). */
  private async uploadThumbnails(task: FileTask, file: File): Promise<Record<string, string>> {
    try {
      const source = task.mimeType.startsWith("video/")
        ? await withTimeout(captureVideoPosterFrame(file), METADATA_TIMEOUT_MS)
        : file;
      const thumbnails = await withTimeout(generateThumbnails(source), THUMBNAIL_TIMEOUT_MS);
      const shas: Record<string, string> = {};
      for (const thumb of thumbnails) {
        const bytes = await blobBytes(thumb.blob);
        const hash = await sha256Hex(bytes.buffer);
        shas[String(thumb.size)] = await this.request(task, (signal) =>
          withRepo((repo) => uploadBlob(repo, bytes, hash, signal))
        );
      }
      return shas;
    } catch (err) {
      if (err instanceof CanceledError || task.controller.signal.aborted) throw new CanceledError();
      return {};
    }
  }

  private async uploadChunks(
    task: FileTask,
    fileHash: string,
    chunks: ChunkInfo[],
    shas: Record<string, string>
  ): Promise<void> {
    const pending = Array.from(new Map(chunks.map((c) => [c.hash, c])).values());
    let next = 0;
    let failed = false;
    const worker = async (): Promise<void> => {
      while (!failed && next < pending.length) {
        const chunk = pending[next++];
        const isThis = (c: ChunkTaskState) => c.hash === chunk.hash;
        try {
          this.setChunkStatus(task, (c) => (isThis(c) ? "uploading" : undefined));
          const sha = await this.request(
            task,
            async (signal) => {
              const bytes = await blobBytes(chunk.blob);
              return withRepo((repo) => uploadBlob(repo, bytes, chunk.hash, signal));
            },
            (attempt) =>
              this.update(task, {
                chunks: task.snapshot.chunks.map((c) => (isThis(c) ? { ...c, attempts: attempt } : c)),
              })
          );
          shas[chunk.hash] = sha;
          rememberChunkSha(fileHash, chunk.hash, sha, { filename: task.snapshot.filename, size: task.snapshot.size });
          this.setChunkStatus(task, (c) => (isThis(c) ? "done" : undefined));
        } catch (err) {
          failed = true;
          if (!(err instanceof CanceledError)) this.setChunkStatus(task, (c) => (isThis(c) ? "error" : undefined));
          throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, pending.length) }, worker));
  }

  /** One commit; resolves with the library it went into. */
  private commitOnce(task: FileTask, body: CommitBody): Promise<CommittedUpload> {
    return this.request(task, () =>
      withRepo(async (repo) => ({ ...(await commitMediaUpload(repo, body)), repoKey: `${repo.owner}/${repo.repo}` }))
    );
  }

  /** Commits, recovering once from stale remembered blobs or chunks that turn out to be missing. */
  private async commit(
    task: FileTask,
    body: CommitBody,
    context: { fileHash: string; chunks: ChunkInfo[]; reused: Set<string> }
  ): Promise<CommittedUpload> {
    try {
      return await this.commitOnce(task, body);
    } catch (err) {
      if (!(err instanceof ApiResponseError)) throw err;
      let redo = new Set<string>();
      const missing = err.details?.missing;
      if (err.code === "unknown_blob") {
        forgetFileProgress(context.fileHash);
        redo = context.reused.size > 0 ? context.reused : new Set(Object.keys(body.chunkBlobShas));
      } else if (err.code === "missing_chunks" && Array.isArray(missing)) {
        redo = new Set(missing.filter((hash): hash is string => typeof hash === "string"));
      }
      const chunks = context.chunks.filter((c) => redo.has(c.hash));
      if (chunks.length === 0) throw err;

      for (const hash of redo) delete body.chunkBlobShas[hash];
      this.setChunkStatus(task, (c) => (redo.has(c.hash) ? "pending" : undefined));
      this.setPhase(task, "uploading", MESSAGES.uploading);
      await this.uploadChunks(task, context.fileHash, chunks, body.chunkBlobShas);
      this.setPhase(task, "committing", MESSAGES.finishing);
      return this.commitOnce(task, body);
    }
  }

  /** One GitHub call: waits while blocked, waits out rate limits (not a failure), retries network/5xx, times out stalls. */
  private async request<T>(
    task: FileTask,
    call: (signal: AbortSignal) => Promise<T>,
    onAttempt?: (attempt: number) => void
  ): Promise<T> {
    let failures = 0;
    for (;;) {
      await this.waitWhileBlocked(task);
      this.throwIfCanceled(task);
      onAttempt?.(failures + 1);

      const controller = new AbortController();
      const abort = () => controller.abort();
      task.controller.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
      try {
        return await call(controller.signal);
      } catch (err) {
        this.throwIfCanceled(task);
        // Anything that isn't an ApiError here is the stall timeout aborting the request.
        const apiError = err instanceof ApiError ? err : null;
        if (apiError?.kind === "rate-limit") {
          this.rateLimitedUntil = Math.max(
            this.rateLimitedUntil,
            Date.now() + rateLimitSeconds(apiError.retryAfterSec) * 1000
          );
          this.refreshBlocked();
          continue;
        }
        if (apiError?.kind === "auth") throw new UploadError("You're signed out — sign in again, then retry");
        if (!apiError || apiError.kind === "offline") {
          if (typeof navigator !== "undefined" && navigator.onLine === false) {
            this.offline = true;
            this.refreshBlocked();
            continue;
          }
          failures += 1;
          if (failures >= MAX_REQUEST_ATTEMPTS) {
            throw new UploadError("Couldn't reach GitHub — check your connection and try again");
          }
          await this.backoff(task, failures);
          continue;
        }
        if (apiError.status >= 500 || apiError.status === 408) {
          failures += 1;
          if (failures >= MAX_REQUEST_ATTEMPTS) throw new ApiResponseError(apiError);
          await this.backoff(task, failures, apiError.retryAfterSec);
          continue;
        }
        throw new ApiResponseError(apiError);
      } finally {
        clearTimeout(timer);
        task.controller.signal.removeEventListener("abort", abort);
      }
    }
  }

  private async backoff(task: FileTask, failures: number, hintSeconds?: number): Promise<void> {
    const exponential = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (failures - 1)) + Math.random() * 500;
    const delay = hintSeconds && hintSeconds > 0 ? Math.min(hintSeconds * 1000, 4 * MAX_BACKOFF_MS) : exponential;
    await this.waitForChange(task.controller.signal, delay);
    this.throwIfCanceled(task);
  }
}
