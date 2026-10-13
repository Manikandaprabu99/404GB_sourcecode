"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getUploadQueue } from "@/lib/upload/queueSingleton";
import type { FileTaskSnapshot, FileUploadStatus } from "@/lib/upload/types";
import { isNativeApp } from "@/lib/native/platform";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import { cardClass, IconTile } from "@/app/components/library/SettingsBlocks";
import { AlertIcon, CheckIcon, CloudOffIcon, PlusIcon } from "@/app/components/library/icons";
import { buttonClass } from "@/app/components/ui/Button";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import TileMeter from "@/app/components/ui/TileMeter";

// Whether the user paused the queue. Module scope, like the queue itself, so it survives switching tabs.
let pausedByUser = false;

const ACTIVE = new Set<FileUploadStatus>(["queued", "hashing", "uploading", "processing", "committing", "paused"]);
const FINISHED = new Set<FileUploadStatus>(["done", "duplicate", "canceled"]);

type Tone = "neutral" | "accent" | "success" | "danger" | "warning";

// The status word in a row's telemetry line: accent while it's live or done, red when it failed.
// (Accent is moss on paper, so it stays readable as text in both themes.)
const TONE_CLASSES: Record<Tone, string> = {
  neutral: "text-ink-muted",
  accent: "text-accent",
  success: "text-accent",
  danger: "text-danger",
  warning: "text-ink",
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

function UpArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
    </svg>
  );
}

/**
 * The brand's 2×2 mark for the drop zone: three solid tiles and the missing one, dashed and
 * breathing, with an arrow in it. Dragging files over fills it in with lime.
 */
function DropMark({ filled }: { filled: boolean }) {
  return (
    <span aria-hidden="true" className="grid grid-cols-2 gap-1.5">
      <span className="h-9 w-9 rounded-[9px] bg-surface-3" />
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-[9px] border-[1.5px] border-dashed transition-colors duration-180 ${
          filled ? "border-transparent text-signal-ink" : "animate-breathe border-accent text-accent"
        }`}
      >
        {filled && <span className="absolute -inset-[1.5px] animate-tile-fill rounded-[9px] bg-signal" />}
        <span className="relative">
          <UpArrowIcon />
        </span>
      </span>
      <span className="h-9 w-9 rounded-[9px] bg-surface-3" />
      <span className="h-9 w-9 rounded-[9px] bg-surface-3" />
    </span>
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
      // A big dashed tile (docs/DESIGN.md › Screens › Upload); a dashed row once there's a queue.
      className={`group flex cursor-pointer items-center border-2 border-dashed transition-[background-color,border-color,transform] duration-180 ease-out-expo active:scale-[0.99] ${
        compact ? "gap-4 rounded-card px-4 py-3.5 text-left" : "min-h-[17rem] flex-col justify-center rounded-card px-6 py-10 text-center sm:min-h-[19rem]"
      } ${dragOver ? "scale-[1.01] border-accent bg-signal/10" : "border-border-strong hover:bg-surface-2/70"}`}
    >
      {compact ? (
        <span
          aria-hidden="true"
          className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-tile border-[1.5px] border-dashed transition-colors duration-180 ${
            dragOver ? "border-transparent text-signal-ink" : "border-accent text-accent"
          }`}
        >
          {dragOver && <span className="absolute -inset-[1.5px] animate-tile-fill rounded-tile bg-signal" />}
          <span className="relative">
            <PlusIcon size={20} />
          </span>
        </span>
      ) : (
        <DropMark filled={dragOver} />
      )}
      <span className={compact ? "min-w-0" : "mt-7 flex flex-col items-center"}>
        <span className={compact ? "block text-body font-semibold text-ink" : "block font-display text-h2 text-ink"}>
          {compact ? "Add more" : "Choose photos and videos"}
        </span>
        <span className={`block text-small text-ink-muted ${compact ? "mt-0.5" : "mt-2"}`}>
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

  // Uploading: the bytes sent so far in the telemetry line, the tile meter under it.
  const sizeText =
    task.status === "uploading" && task.bytesUploaded > 0
      ? `${formatBytes(Math.min(task.bytesUploaded, task.size))} / ${formatBytes(task.size)}`
      : formatBytes(task.size);
  const meterValue = task.status === "processing" || task.status === "committing" ? 100 : percentOf(task);
  const indeterminate = task.status === "hashing" || task.status === "queued";

  return (
    <li className="px-4 py-3 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <IconTile>
          <FileKindIcon video={task.mimeType.startsWith("video/")} />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-ink" title={task.filename}>
            {task.filename}
          </p>
          {/* A telemetry line: size (or bytes sent) and the status (2.4 MB · UPLOADING 42%). */}
          <p className="telemetry mt-1 truncate text-ink-muted">
            <span className="tabular-nums">{sizeText}</span>
            <span aria-hidden="true" className="px-[0.45em] text-ink-faint">
              ·
            </span>
            <span className={TONE_CLASSES[pill.tone]}>{pill.label}</span>
          </p>
        </div>
        {task.status === "done" && (
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 animate-check-pop items-center justify-center rounded-[7px] bg-signal text-signal-ink">
            <CheckIcon size={14} strokeWidth={3} />
          </span>
        )}
        {failed && (
          <span aria-hidden="true" className="flex shrink-0 text-danger">
            <AlertIcon size={20} />
          </span>
        )}
        {active && (
          <button
            type="button"
            onClick={() => onCancel(task.clientId)}
            aria-label={`Cancel ${task.filename}`}
            title="Cancel"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-tile text-ink-muted transition-[background-color,color,transform] duration-180 ease-out-expo hover:bg-surface-2 hover:text-ink active:scale-[0.94]"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        )}
      </div>

      {active && (
        // Decorative: the telemetry line above says how far it got.
        <div className="mt-2.5 pl-12" aria-hidden="true">
          <TileMeter
            value={indeterminate ? undefined : meterValue}
            max={indeterminate ? undefined : 100}
            tiles={16}
            fluid
            valueText=""
            active={task.status !== "paused"}
          />
        </div>
      )}

      {message && <p className="mt-2 pl-12 text-small text-ink-muted">{message}</p>}

      {failed && (
        <div className="mt-2.5 flex items-start justify-between gap-3 pl-12">
          <div className="min-w-0">
            <p className="text-small text-danger">{errorText}</p>
            {rawError && rawError !== errorText && (
              <details className="mt-1 text-micro text-ink-muted">
                <summary className="cursor-pointer select-none">Details</summary>
                <p className="mt-1 break-words font-mono">{rawError}</p>
              </details>
            )}
          </div>
          <button type="button" onClick={() => onRetry(task.clientId)} className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0`}>
            Retry
          </button>
        </div>
      )}
    </li>
  );
});

export default function UploadClient({ repo }: { /** owner/repo, for the telemetry line. */ repo?: string }) {
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
      bytesDone,
      bytesTotal,
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

  // The header's telemetry line: what's in the queue (or the promise), and where it goes.
  const telemetry =
    summary.counted > 0
      ? [summary.counted === 1 ? "1 file" : `${summary.counted.toLocaleString()} files`, formatBytes(summary.bytesTotal), repo]
      : ["Original quality", repo];
  const percent = Math.round(summary.fraction * 100);

  return (
    <ScrollArea scrollKey="upload">
      <PageHeader title="Upload" width="column" telemetry={<Telemetry items={telemetry} />} />
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pt-1 sm:px-6 sm:pt-3">
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
          <div
            role="status"
            className="flex items-center gap-3 rounded-control border border-border/60 bg-surface-2 py-2 pl-2 pr-3 text-small text-ink-muted animate-fade-in"
          >
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-tile bg-surface-3">
              <CloudOffIcon size={16} />
            </span>
            <span className="min-w-0 flex-1 py-1">You&apos;re offline. Uploads will continue when you&apos;re back online.</span>
          </div>
        )}

        <Dropzone compact={visible.length > 0} onFiles={onFiles} />

        {visible.length > 0 && (
          <section aria-labelledby="upload-summary" className="flex flex-col gap-3">
            <div className={`${cardClass} p-4 sm:p-5`}>
              <div aria-live="polite">
                <h2 id="upload-summary" className="font-display text-h2 text-ink">
                  {headline}
                </h2>
                {details.length > 0 && <p className="mt-1 text-small text-ink-muted">{details.join(" · ")}</p>}
              </div>
              {working && (
                <TileMeter
                  value={Math.round(summary.fraction * 1000)}
                  max={1000}
                  tiles={24}
                  fluid
                  label={`${formatBytes(summary.bytesDone)} / ${formatBytes(summary.bytesTotal)}`}
                  valueText={`${percent}%`}
                  active={!paused}
                  ariaLabel="Upload progress"
                  className="mt-4"
                />
              )}
              {(summary.failed > 1 || working || paused || summary.clearable) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {summary.failed > 1 && (
                    <button type="button" onClick={retryAll} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      Retry all
                    </button>
                  )}
                  {(working || paused) && (
                    <button type="button" onClick={togglePause} className={buttonClass({ variant: "secondary", size: "sm" })}>
                      {paused ? "Resume" : "Pause"}
                    </button>
                  )}
                  {summary.clearable && (
                    <button type="button" onClick={clearFinished} className={buttonClass({ variant: "ghost", size: "sm" })}>
                      Clear finished
                    </button>
                  )}
                </div>
              )}
            </div>

            <ul aria-label="Files" className={`divide-y divide-border/60 overflow-hidden ${cardClass}`}>
              {visible.map((task) => (
                <FileRow key={task.clientId} task={task} onCancel={onCancel} onRetry={onRetry} />
              ))}
            </ul>
          </section>
        )}

        {visible.length > 0 && !working && summary.done + summary.duplicates > 0 && (
          <Link href="/gallery" className={`${buttonClass({ variant: "primary" })} group w-fit animate-fade-in`}>
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
