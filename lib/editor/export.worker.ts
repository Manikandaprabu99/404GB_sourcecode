// Web Worker: full-resolution export on an OffscreenCanvas, off the main thread.
// lib/editor/exportImage.ts falls back to the main thread if this fails.

import { exportEdit, type ExportRequest } from "./exportCore";

export {};

interface ExportMessage {
  id: number;
  request: ExportRequest;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ExportMessage>) => void) | null;
  postMessage(message: unknown): void;
};

scope.onmessage = async (event) => {
  const { id, request } = event.data;
  try {
    const result = await exportEdit(request);
    scope.postMessage({ id, ok: true, result });
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
