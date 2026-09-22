"use client";

import { useEffect, useState } from "react";
import type { MediaIndexEntry } from "@/lib/media";

interface MediaViewerProps {
  items: MediaIndexEntry[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

/**
 * Full-screen overlay viewer. Loads progressively: the already-cached 320px
 * thumbnail appears instantly, the 800px thumbnail swaps in as soon as it's
 * fetched, and the original full-resolution file is only fetched if the
 * viewer explicitly requests it (reconstructing chunks server-side is not
 * cheap, so it's on-demand rather than automatic).
 */
export default function MediaViewer({
  items,
  index,
  onClose,
  onNavigate,
}: MediaViewerProps) {
  const item = items[index];
  const isVideo = item?.mimeType?.startsWith("video/");
  const [stage, setStage] = useState<"thumb" | "medium" | "original">("thumb");
  const [loadingOriginal, setLoadingOriginal] = useState(false);

  useEffect(() => {
    setStage("thumb");
    setLoadingOriginal(false);
  }, [item?.id]);

  useEffect(() => {
    if (!item || isVideo) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setStage((s) => (s === "original" ? s : "medium"));
    };
    img.src = `/api/media/thumb/${item.id}/800`;
    return () => {
      cancelled = true;
    };
  }, [item?.id, isVideo]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onNavigate(Math.min(index + 1, items.length - 1));
      else if (e.key === "ArrowLeft") onNavigate(Math.max(index - 1, 0));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, items.length, onClose, onNavigate]);

  if (!item) return null;

  const src =
    stage === "original"
      ? `/api/media/object/${item.id}`
      : stage === "medium"
      ? `/api/media/thumb/${item.id}/800`
      : `/api/media/thumb/${item.id}/320`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-4 p-4 text-sm text-neutral-300"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{item.filename}</span>
        <div className="flex items-center gap-3">
          {stage !== "original" && isVideo && (
            <button
              className="rounded border border-neutral-600 px-2 py-1 disabled:opacity-50"
              disabled={loadingOriginal}
              onClick={() => {
                setLoadingOriginal(true);
                setStage("original");
                setLoadingOriginal(false);
              }}
            >
              Play video
            </button>
          )}
          {stage !== "original" && !isVideo && (
            <button
              className="rounded border border-neutral-600 px-2 py-1 disabled:opacity-50"
              disabled={loadingOriginal}
              onClick={() => {
                setLoadingOriginal(true);
                const full = new Image();
                full.onload = () => {
                  setStage("original");
                  setLoadingOriginal(false);
                };
                full.onerror = () => setLoadingOriginal(false);
                full.src = `/api/media/object/${item.id}`;
              }}
            >
              {loadingOriginal ? "Loading full res…" : "View full resolution"}
            </button>
          )}
          <button
            className="rounded border border-neutral-600 px-2 py-1"
            onClick={onClose}
          >
            Close (Esc)
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4">
        {index > 0 && (
          <button
            aria-label="Previous"
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-2xl text-white"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index - 1);
            }}
          >
            ‹
          </button>
        )}

        {isVideo && stage === "original" ? (
          <video
            src={`/api/media/object/${item.id}`}
            poster={`/api/media/thumb/${item.id}/1600`}
            controls
            autoPlay
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={item.filename}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        )}

        {index < items.length - 1 && (
          <button
            aria-label="Next"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-2xl text-white"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(index + 1);
            }}
          >
            ›
          </button>
        )}
      </div>

      <div className="p-3 text-center text-xs text-neutral-500">
        {index + 1} / {items.length}
      </div>
    </div>
  );
}
