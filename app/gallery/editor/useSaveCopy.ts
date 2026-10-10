"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import { exportEditedImage, type ExportRequest } from "@/lib/editor/exportImage";
import { editedFilename, uploadProgress } from "@/lib/editor/save";
import { getUploadQueue } from "@/lib/upload/queueSingleton";

export type SavePhase = "idle" | "exporting" | "uploading" | "error" | "done";

export interface SaveState {
  phase: SavePhase;
  /** 0..1 */
  fraction: number;
  label: string;
  error: string | null;
}

const IDLE: SaveState = { phase: "idle", fraction: 0, label: "", error: null };

function readableError(raw: string | undefined): string {
  const message = (raw ?? "").replace(/^Error:\s*/, "").trim();
  return message || "The copy couldn't be saved.";
}

/** Saves an edit as a new item through the app-wide upload queue — the original is never touched. */
export function useSaveCopy(media: MediaIndexEntry, onSaved: (newMediaId: string | null) => void) {
  const [state, setState] = useState<SaveState>(IDLE);
  const [clientId, setClientId] = useState<string | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const finishedRef = useRef(false);
  const exportingRef = useRef(false);

  useEffect(() => {
    if (!clientId) return;
    const unsubscribe = getUploadQueue().subscribe((snapshots) => {
      const task = snapshots.find((snapshot) => snapshot.clientId === clientId);
      if (!task || finishedRef.current) return;
      if (task.status === "done" || task.status === "duplicate") {
        finishedRef.current = true;
        setState({ phase: "done", fraction: 1, label: task.status === "done" ? "Saved" : "Already in your library", error: null });
        onSavedRef.current(task.status === "done" ? (task.mediaId ?? null) : null);
      } else if (task.status === "error" || task.status === "canceled") {
        setState({
          phase: "error",
          fraction: 0,
          label: "",
          error: task.status === "canceled" ? "Saving was canceled." : readableError(task.error),
        });
      } else {
        const progress = uploadProgress(task);
        setState({ phase: "uploading", fraction: progress.fraction, label: progress.label, error: null });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [clientId]);

  const save = useCallback(
    async (request: ExportRequest) => {
      if (exportingRef.current) return;
      exportingRef.current = true;
      finishedRef.current = false;
      setClientId(null);
      setState({ phase: "exporting", fraction: 0.02, label: "Preparing your copy…", error: null });
      try {
        const result = await exportEditedImage(request);
        const extension = result.mimeType === "image/png" ? "png" : "jpg";
        const file = new File([result.blob], editedFilename(media.filename, extension), {
          type: result.mimeType,
          lastModified: Date.now(),
        });
        // Keep the copy next to the original in the timeline even when the original has no capture date.
        const [id] = getUploadQueue().addFiles([file], {
          editedFrom: media.id,
          takenAt: media.takenAt ?? media.createdAt,
        });
        if (!id) throw new Error("The edited copy couldn't be queued for upload.");
        setState({ phase: "uploading", fraction: 0.04, label: "Saving copy…", error: null });
        setClientId(id);
      } catch (err) {
        setState({ phase: "error", fraction: 0, label: "", error: readableError(err instanceof Error ? err.message : String(err)) });
      } finally {
        exportingRef.current = false;
      }
    },
    [media.createdAt, media.filename, media.id, media.takenAt]
  );

  /** Re-sends the same copy when the upload failed; re-exports when the export itself failed. */
  const retry = useCallback(
    (request: ExportRequest) => {
      if (clientId) {
        setState({ phase: "uploading", fraction: 0.04, label: "Saving copy…", error: null });
        getUploadQueue().retryFile(clientId);
      } else {
        void save(request);
      }
    },
    [clientId, save]
  );

  /** Back to editing after a failure; the failed upload is canceled so it doesn't linger in the queue. */
  const dismiss = useCallback(() => {
    if (clientId) getUploadQueue().cancelFile(clientId);
    setClientId(null);
    setState(IDLE);
  }, [clientId]);

  return { state, save, retry, dismiss };
}
