"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getUploadQueue } from "@/lib/upload/queueSingleton";
import type { FileTaskSnapshot, FileUploadStatus } from "@/lib/upload/types";
import { isNativeApp } from "@/lib/native/platform";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";

// Whether the user paused the queue. Module scope, like the queue itself, so it survives switching tabs.
let pausedByUser = false;

const ACTIVE = new Set<FileUploadStatus>(["queued", "hashing", "uploading", "processing", "committing", "paused"]);
const FINISHED = new Set<FileUploadStatus>(["done", "duplicate", "canceled"]);

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warning: "bg-warning/15 text-warning",
};

// Queue messages that describe internals rather than what the person sees.
const TECHNICAL = /hash|chunk|commit|manifest|metadata|thumbnail|sha-?256|blob|init\b|\bapi\b|status \d|\(\d{3}\)/i;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function percentOf(task: FileTaskSnapshot): number {
  return task.size > 0 ? Math.min(100, Math.round((task.bytesUploaded / task.size) * 100)) : 0;
}

function statusPill(task: FileTaskSnapshot): { label: string; tone: Tone } {
  switch (task.status) {
    case "queued":
      return { label: "Waiting", tone: "neutral" };
    case "hashing":
      return { label: "Preparing", tone: "accent" };
    case "uploading":
      return { label: `Uploading ${percentOf(task)}%`, tone: "accent" };
    case "processing":
    case "committing":
      return { label: "Finishing up", tone: "accent" };
    case "paused":
      return { label: "Paused", tone: "warning" };
    case "duplicate":
      return { label: "Already in your library", tone: "neutral" };
    case "done":
      return { label: "Done", tone: "success" };
    case "error":
      return { label: "Couldn't upload", tone: "danger" };
    case "canceled":
      return { label: "Canceled", tone: "neutral" };
  }
}

function fallbackMessage(status: FileUploadStatus): string | null {
  switch (status) {
    case "hashing":
      return "Getting it ready…";
    case "processing":
    case "committing":
      return "Adding it to your library…";
    case "duplicate":
      return "This exact file is already backed up, so it wasn't uploaded again.";
    default:
      return null;
  }
}

/** The queue's own message when it's friendly and adds something the pill doesn't say. */
function friendlyMessage(task: FileTaskSnapshot): string | null {
  const message = task.message?.trim() ?? "";
  if (!message || TECHNICAL.test(message)) return fallbackMessage(task.status);
  const plain = message.toLowerCase().replace(/[.…!]+$/, "");
  const redundant = ["queued", "waiting", "done", "failed", "canceled", "cancelled", "uploading", "paused"];
  return redundant.includes(plain) ? fallbackMessage(task.status) : message;
}

function friendlyError(raw: string | undefined): string {
  const text = (raw ?? "").replace(/^\w*Error:\s*/, "").trim();
  if (/\b401\b|signed out|sign-in expired|not authenticated|reauth/i.test(text)) {
    return "You've been signed out. Sign in again, then retry.";
  }
  if (/\b429\b|rate limit|limiting/i.test(text)) return "GitHub is limiting uploads right now. Try again in a few minutes.";
  if (/network|failed to fetch|load failed|offline|connection/i.test(text)) {
    return "The connection dropped. Check your internet, then retry.";
  }
  if (/\b413\b|too large/i.test(text)) return "This file is too large to upload.";
  if (/\b503\b|busy/i.test(text)) return "Your library was busy. Retry in a moment.";
  if (text && text.length <= 140 && !TECHNICAL.test(text) && !/[{}]|undefined|null/.test(text)) return text;
  return "Something went wrong while uploading.";
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function UploadCloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 16.5a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 10.5v.06A3.94 3.94 0 0 1 17 18H8" />
      <path d="M12 12v7m0-7 3 3m-3-3-3 3" />
    </svg>
  );
}

function FileKindIcon({ video }: { video: boolean }) {
  return video ? (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5.5" width="13" height="13" rx="2.5" />
      <path d="m16 10.5 4.2-2.4a.5.5 0 0 1 .8.4v7a.5.5 0 0 1-.8.4L16 13.5" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <circle cx="9" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
      <path d="m4.5 17 4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" />
    </svg>
  );
}

function ProgressBar({ value, tone, indeterminate }: { value: number; tone: "accent" | "muted" | "danger"; indeterminate?: boolean }) {
  const color = tone === "danger" ? "bg-danger" : tone === "muted" ? "bg-ink-faint" : "bg-accent";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
      {indeterminate ? (
        <div className={`absolute inset-y-0 left-0 w-2/5 rounded-full ${color} animate-indeterminate`} />
      ) : (
        <div
          className={`h-full rounded-full transition-[width] duration-320 ease-out-expo ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}

function Dropzone({ compact, onFiles }: { compact: boolean; onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Add photos and videos"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current += 1;
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current -= 1;
        if (dragCounter.current <= 0) {
          dragCounter.current = 0;
          setDragOver(false);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setDragOver(false);
        if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files));
      }}
      className={`group flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed text-left transition-all duration-180 ease-out-expo active:scale-[0.99] ${
        compact ? "px-4 py-4" : "flex-col px-6 py-12 text-center"
      } ${
        dragOver
          ? "scale-[1.01] border-accent bg-accent/10"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
      }`}
    >
      <span
        className={`flex shrink-0 items-center justify-center rounded-full transition-all duration-250 ease-out-expo ${
          compact ? "h-11 w-11" : "h-16 w-16"
        } ${dragOver ? "scale-110 bg-accent/20 text-accent" : "bg-accent/10 text-accent group-hover:scale-105"}`}
      >
        <UploadCloudIcon />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">
          {compact ? "Add more" : "Choose photos and videos"}
        </span>
        <span className="mt-0.5 block text-small text-ink-muted">
          <span className="sm:hidden">Tap to pick from your phone</span>
          <span className="hidden sm:inline">Drag them here, or click to browse</span>
        </span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            onFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

const FileRow = memo(function FileRow({
  task,
  onCancel,
  onRetry,
}: {
  task: FileTaskSnapshot;
  onCancel: (clientId: string) => void;
  onRetry: (clientId: string) => void;
}) {
  const pill = statusPill(task);
  const active = ACTIVE.has(task.status);
  const failed = task.status === "error";
  const message = failed ? null : friendlyMessage(task);
  const errorText = failed ? friendlyError(task.error ?? task.message) : null;
  const rawError = failed ? (task.error ?? "").replace(/^\w*Error:\s*/, "").trim() : "";
  const showProgress = active || failed;

  return (
    <li className="rounded-xl border border-border bg-surface p-3.5 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-muted">
          <FileKindIcon video={task.mimeType.startsWith("video/")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink" title={task.filename}>
            {task.filename}
          </p>
          <p className="text-small text-ink-faint">{formatBytes(task.size)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold tabular-nums ${TONE_CLASSES[pill.tone]}`}
        >
          {pill.label}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onCancel(task.clientId)}
            aria-label={`Cancel ${task.filename}`}
            title="Cancel"
            className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>

      {showProgress && (
        <div className="mt-3">
          <ProgressBar
            value={failed ? percentOf(task) : task.status === "processing" || task.status === "committing" ? 100 : percentOf(task)}
            tone={failed ? "danger" : task.status === "paused" ? "muted" : "accent"}
            indeterminate={task.status === "hashing" || task.status === "queued"}
          />
        </div>
      )}

      {message && <p className="mt-2 text-small text-ink-muted">{message}</p>}

      {failed && (
        <div className="mt-2.5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-small text-danger">{errorText}</p>
            {rawError && rawError !== errorText && (
              <details className="mt-1 text-micro text-ink-faint">
                <summary className="cursor-pointer select-none">Details</summary>
                <p className="mt-1 break-words font-mono">{rawError}</p>
              </details>
            )}
          </div>
          <button
            type="button"
            onClick={() => onRetry(task.clientId)}
            className="h-10 shrink-0 rounded-full bg-ink px-4 text-small font-semibold text-bg transition-all duration-180 ease-out-expo active:scale-95"
          >
            Retry
          </button>
        </div>
      )}
    </li>
  );
});

export default function UploadClient() {
  // Seeded from the app-wide queue so coming back to this tab shows progress on the first frame.
  const [visible, setVisible] = useState<FileTaskSnapshot[]>(() =>
    typeof window === "undefined" ? [] : getUploadQueue().getSnapshots()
  );
  const [paused, setPaused] = useState(pausedByUser);
  const [native, setNative] = useState(false);
  const online = useOnline();

  useEffect(() => {
    setNative(isNativeApp());
    return getUploadQueue().subscribe(setVisible);
  }, []);

  const summary = useMemo(() => {
    let active = 0;
    let done = 0;
    let duplicates = 0;
    let failed = 0;
    let bytesDone = 0;
    let bytesTotal = 0;
    for (const t of visible) {
      if (t.status === "canceled") continue;
      bytesTotal += t.size;
      if (ACTIVE.has(t.status)) {
        active += 1;
        bytesDone += Math.min(t.bytesUploaded, t.size);
      } else {
        bytesDone += t.size;
        if (t.status === "done") done += 1;
        else if (t.status === "duplicate") duplicates += 1;
        else if (t.status === "error") failed += 1;
      }
    }
    return {
      active,
      done,
      duplicates,
      failed,
      counted: active + done + duplicates + failed,
      clearable: visible.some((t) => FINISHED.has(t.status)),
      fraction: bytesTotal > 0 ? bytesDone / bytesTotal : 0,
    };
  }, [visible]);

  const onFiles = useCallback((files: File[]) => {
    getUploadQueue().addFiles(files);
  }, []);
  const onCancel = useCallback((clientId: string) => getUploadQueue().cancelFile(clientId), []);
  const onRetry = useCallback((clientId: string) => getUploadQueue().retryFile(clientId), []);

  function togglePause() {
    const queue = getUploadQueue();
    if (paused) queue.resumeAll();
    else queue.pauseAll();
    pausedByUser = !paused;
    setPaused(!paused);
  }

  function clearFinished() {
    getUploadQueue().clearFinished();
  }

  function retryAll() {
    const queue = getUploadQueue();
    for (const t of visible) if (t.status === "error") queue.retryFile(t.clientId);
  }

  const working = summary.active > 0;
  const position = Math.min(summary.counted, summary.done + summary.duplicates + summary.failed + 1);
  const headline = working
    ? paused
      ? "Uploads paused"
      : `Uploading ${position} of ${summary.counted}`
    : summary.failed > 0
      ? summary.failed === 1
        ? "1 file couldn't upload"
        : `${summary.failed} files couldn't upload`
      : summary.counted > 0
        ? "All done"
        : "Nothing uploading";
  const details = [
    summary.done > 0 && `${summary.done} uploaded`,
    summary.duplicates > 0 && `${summary.duplicates} already in your library`,
    working && summary.failed > 0 && `${summary.failed} couldn't upload`,
  ].filter(Boolean) as string[];

  return (
    <ScrollArea scrollKey="upload">
      <PageHeader title="Upload" />
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-2 sm:px-6 sm:pt-6">
        <header className="flex flex-col gap-1.5 animate-fade-in-up">
          <p className="text-body text-ink-muted">
            Photos and videos keep their original quality. Uploads continue while you browse the app.
          </p>
          {native && (
            <Link
              href="/settings"
              className="group mt-1 inline-flex w-fit items-center gap-1.5 text-small font-medium text-accent"
            >
              Automatic backup
              <span aria-hidden className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
                →
              </span>
              <span className="text-ink-muted">Settings</span>
            </Link>
          )}
        </header>

        {!online && (
          <div role="status" className="flex items-center gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-small text-warning animate-fade-in">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.2-2.4M19 12.5a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 11 5M12 20h.01" />
            </svg>
            You&apos;re offline. Uploads will continue when you&apos;re back online.
          </div>
        )}

        <Dropzone compact={visible.length > 0} onFiles={onFiles} />

        {visible.length > 0 && (
          <section aria-labelledby="upload-summary" className="flex flex-col gap-3">
            <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0" aria-live="polite">
                  <h2 id="upload-summary" className="text-body font-semibold text-ink">
                    {headline}
                  </h2>
                  {details.length > 0 && <p className="text-small text-ink-muted">{details.join(" · ")}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.failed > 1 && (
                    <button
                      type="button"
                      onClick={retryAll}
                      className="h-10 rounded-full border border-border px-4 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
                    >
                      Retry all
                    </button>
                  )}
                  {(working || paused) && (
                    <button
                      type="button"
                      onClick={togglePause}
                      className="h-10 rounded-full border border-border px-4 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2"
                    >
                      {paused ? "Resume" : "Pause"}
                    </button>
                  )}
                  {summary.clearable && (
                    <button
                      type="button"
                      onClick={clearFinished}
                      className="h-10 rounded-full px-4 text-small font-medium text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
                    >
                      Clear finished
                    </button>
                  )}
                </div>
              </div>
              {working && (
                <div className="mt-3">
                  <ProgressBar value={summary.fraction * 100} tone={paused ? "muted" : "accent"} />
                </div>
              )}
            </div>

            <ul className="flex flex-col gap-2.5" aria-label="Files">
              {visible.map((task) => (
                <FileRow key={task.clientId} task={task} onCancel={onCancel} onRetry={onRetry} />
              ))}
            </ul>
          </section>
        )}

        {visible.length > 0 && !working && summary.done + summary.duplicates > 0 && (
          <Link
            href="/gallery"
            className="group inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-small font-semibold text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95 animate-fade-in"
          >
            See them in your library
            <span aria-hidden className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        )}
      </main>
    </ScrollArea>
  );
}
