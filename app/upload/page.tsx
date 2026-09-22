"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadQueue } from "@/lib/upload/uploadQueue";
import type { FileTaskSnapshot } from "@/lib/upload/types";

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

function statusColor(status: FileTaskSnapshot["status"]): string {
  switch (status) {
    case "done":
      return "text-green-400";
    case "error":
      return "text-red-400";
    case "canceled":
      return "text-neutral-500";
    case "paused":
      return "text-yellow-400";
    default:
      return "text-neutral-300";
  }
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
    <li className="rounded border border-neutral-800 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate">{item.filename}</span>
        <span className={statusColor(item.status)}>{item.status}</span>
      </div>
      <p className="mt-1 text-neutral-500">
        {item.message}
        {chunkTotal > 0 && ` — ${chunkDone}/${chunkTotal} chunks`}
        {chunkUploading > 0 && ` (${chunkUploading} in flight)`}
      </p>

      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-neutral-800">
        <div
          className={`h-full transition-all ${
            item.status === "error" ? "bg-red-500" : "bg-blue-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-right text-[11px] text-neutral-600">
        {formatBytes(item.bytesUploaded)} / {formatBytes(item.size)}
      </p>

      {item.error && <p className="mt-1 break-words text-red-400">{item.error}</p>}

      <div className="mt-2 flex gap-2">
        {active && (
          <button
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        {item.status === "error" && (
          <button
            className="rounded border border-neutral-700 px-2 py-0.5 text-xs"
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
    return queue.subscribe(setItems);
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
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-8">
      <h1 className="text-2xl font-bold">Upload photos &amp; videos</h1>
      <input
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            queueRef.current!.addFiles(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

      {items.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            {totals.done}/{totals.total} done
            {totals.failed > 0 && `, ${totals.failed} failed`}
          </p>
          <div className="flex gap-2">
            {!paused ? (
              <button
                className="rounded border border-neutral-700 px-3 py-1 text-xs"
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
                className="rounded border border-neutral-700 px-3 py-1 text-xs"
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
        <ul className="flex flex-col gap-2">
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
          className="self-start rounded border border-neutral-700 px-3 py-1.5 text-sm underline"
          onClick={() => router.push("/gallery")}
        >
          Go to gallery
        </button>
      )}
    </main>
  );
}
