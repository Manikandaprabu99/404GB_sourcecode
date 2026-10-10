import { exportEdit, type ExportRequest, type ExportResult } from "./exportCore";

export type { ExportRequest, ExportResult };

const WORKER_TIMEOUT_MS = 90_000;

function canExportInWorker(): boolean {
  return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap === "function";
}

function exportInWorker(request: ExportRequest): Promise<ExportResult> {
  return new Promise<ExportResult>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./export.worker.ts", import.meta.url));
    } catch (err) {
      reject(err);
      return;
    }
    // One worker per export, terminated right after, so its large buffers are freed at once.
    const finish = () => {
      window.clearTimeout(timer);
      worker.terminate();
    };
    const timer = window.setTimeout(() => {
      finish();
      reject(new Error("Export timed out"));
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; result?: ExportResult; error?: string }>) => {
      finish();
      if (event.data.ok && event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Export failed"));
    };
    worker.onerror = (event: ErrorEvent) => {
      finish();
      reject(event.error ?? new Error(event.message || "Export worker failed"));
    };
    worker.postMessage({ id: 1, request });
  });
}

/** Full-resolution render + encode of the edit: in a Worker when possible, else on the main thread. */
export async function exportEditedImage(request: ExportRequest): Promise<ExportResult> {
  if (canExportInWorker()) {
    try {
      return await exportInWorker(request);
    } catch (err) {
      console.warn("[404gb] export worker failed; exporting on the main thread", err);
    }
  }
  return exportEdit(request);
}
