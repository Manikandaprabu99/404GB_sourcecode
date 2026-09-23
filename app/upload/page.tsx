"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadQueue } from "@/lib/upload/uploadQueue";
import type { FileTaskSnapshot } from "@/lib/upload/types";
import NavBar from "../components/NavBar";
import AutoBackupToggle from "../components/AutoBackupToggle";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

const STATUS_STYLES: Record<FileTaskSnapshot["status"], string> = {
  done: "bg-success/15 text-success",
  error: "bg-danger/15 text-danger",
  canceled: "bg-surface-3 text-ink-faint",
  paused: "bg-warning/15 text-warning",
  queued: "bg-surface-3 text-ink-muted",
  hashing: "bg-accent/15 text-accent",
  uploading: "bg-accent/15 text-accent",
  processing: "bg-accent/15 text-accent",
  committing: "bg-accent/15 text-accent",
};

function StatusPill({ status }: { status: FileTaskSnapshot["status"] }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-micro font-medium uppercase tracking-wide ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

function UploadCloudIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 16.5a4 4 0 0 1 .5-7.97A5.5 5.5 0 0 1 18 10.5v.06A3.94 3.94 0 0 1 17 18H8" />
      <path d="M12 12v7m0-7 3 3m-3-3-3 3" />
    </svg>
  );
}

function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
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
      onDragOver={(e) => {
        e.preventDefault();
      }}
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
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onFiles(Array.from(e.dataTransfer.files));
        }
      }}
      className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all duration-180 ease-out-expo ${
        dragOver
          ? "scale-[1.01] border-accent bg-accent/10"
          : "border-border bg-surface hover:border-border-strong hover:bg-surface-2"
      }`}
    >
      <span
        className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors duration-180 ${
          dragOver ? "bg-accent/20 text-accent" : "bg-surface-2 text-ink-muted"
        }`}
      >
        <UploadCloudIcon />
      </span>
      <div>
        <p className="text-body font-medium text-ink">
          Drag & drop photos or videos
        </p>
        <p className="mt-1 text-small text-ink-muted">or tap to browse your files</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />
    </div>
  );
}

function FileRow({
  item,
  onCancel,
  onRetry,
}: {
  item: FileTaskSnapshot;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const chunkTotal = item.chunks.length;
  const chunkDone = item.chunks.filter(
    (c) => c.status === "done" || c.status === "skipped"
  ).length;
  const chunkUploading = item.chunks.filter((c) => c.status === "uploading").length;
  const pct = item.size > 0 ? Math.min(100, (item.bytesUploaded / item.size) * 100) : 0;
  const active = !["done", "error", "canceled"].includes(item.status);

  return (
    <li className="animate-fade-in-up rounded-lg border border-border bg-surface p-3.5 text-body">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium text-ink">{item.filename}</span>
        <StatusPill status={item.status} />
      </div>
      <p className="mt-1 text-small text-ink-muted">
        {item.message}
        {chunkTotal > 0 && ` — ${chunkDone}/${chunkTotal} chunks`}
        {chunkUploading > 0 && ` (${chunkUploading} in flight)`}
      </p>

      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-[width] duration-320 ease-out-expo ${
            item.status === "error" ? "bg-danger" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-right text-micro text-ink-faint">
        {formatBytes(item.bytesUploaded)} / {formatBytes(item.size)}
      </p>

      {item.error && <p className="mt-1 break-words text-small text-danger">{item.error}</p>}

      <div className="mt-2.5 flex gap-2">
        {active && (
          <button
            className="rounded-full border border-border px-3 py-2.5 text-small text-ink-muted transition-colors duration-180 hover:border-border-strong hover:text-ink"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        {item.status === "error" && (
          <button
            className="rounded-full border border-border px-3 py-2.5 text-small text-ink-muted transition-colors duration-180 hover:border-border-strong hover:text-ink"
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    </li>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const queueRef = useRef<UploadQueue | null>(null);
  const [items, setItems] = useState<FileTaskSnapshot[]>([]);
  const [paused, setPaused] = useState(false);

  if (!queueRef.current) {
    queueRef.current = new UploadQueue();
  }

  useEffect(() => {
    const queue = queueRef.current!;
    const unsubscribe = queue.subscribe(setItems);
    return () => {
      unsubscribe();
      queue.dispose(); // detach the online/offline listeners (Phase 5)
    };
  }, []);

  const busy = items.some((i) => !["done", "error", "canceled"].includes(i.status));
  const allSettled =
    items.length > 0 && items.every((i) => ["done", "error", "canceled"].includes(i.status));

  const totals = useMemo(() => {
    const done = items.filter((i) => i.status === "done").length;
    const failed = items.filter((i) => i.status === "error").length;
    return { done, failed, total: items.length };
  }, [items]);

  return (
    <>
      <NavBar />
      <main className="mx-auto flex max-w-xl flex-col gap-5 p-4 pb-tabbar-safe sm:p-8">
        <h1 className="text-h1 font-bold tracking-tight">Upload photos &amp; videos</h1>

        <AutoBackupToggle queue={queueRef.current!} />

        <Dropzone onFiles={(files) => queueRef.current!.addFiles(files)} />

        {items.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-small text-ink-muted">
              {totals.done}/{totals.total} done
              {totals.failed > 0 && `, ${totals.failed} failed`}
            </p>
            <div className="flex gap-2">
              {!paused ? (
                <button
                  className="rounded-full border border-border px-3.5 py-1.5 text-small text-ink-muted transition-colors duration-180 hover:border-border-strong hover:text-ink disabled:opacity-40"
                  disabled={!busy}
                  onClick={() => {
                    queueRef.current!.pauseAll();
                    setPaused(true);
                  }}
                >
                  Pause queue
                </button>
              ) : (
                <button
                  className="rounded-full border border-border px-3.5 py-1.5 text-small text-ink-muted transition-colors duration-180 hover:border-border-strong hover:text-ink"
                  onClick={() => {
                    queueRef.current!.resumeAll();
                    setPaused(false);
                  }}
                >
                  Resume queue
                </button>
              )}
            </div>
          </div>
        )}

        {items.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <FileRow
                key={item.clientId}
                item={item}
                onCancel={() => queueRef.current!.cancelFile(item.clientId)}
                onRetry={() => queueRef.current!.retryFile(item.clientId)}
              />
            ))}
          </ul>
        )}

        {allSettled && (
          <button
            className="group inline-flex w-fit items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-small font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95"
            onClick={() => router.push("/gallery")}
          >
            Go to gallery
            <span className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">→</span>
          </button>
        )}
      </main>
    </>
  );
}
