// Client-side thumbnail generation. Prefers a Web Worker (OffscreenCanvas) so
// resizing large photos doesn't block the main thread; falls back to a
// synchronous <canvas> resize on the main thread if either isn't supported.

export const THUMBNAIL_SIZES = [320, 800, 1600] as const;
export type ThumbnailSize = (typeof THUMBNAIL_SIZES)[number];

export interface GeneratedThumbnail {
  size: ThumbnailSize;
  blob: Blob;
}

let sharedWorker: Worker | null = null;
let workerFailed = false;

function getWorker(): Worker | null {
  if (typeof window === "undefined") return null;
  if (workerFailed) return null;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
    return null;
  }
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(new URL("./worker.ts", import.meta.url));
    } catch {
      workerFailed = true;
      return null;
    }
  }
  return sharedWorker;
}

async function generateViaMainThreadCanvas(
  file: File | Blob,
  sizes: readonly number[]
): Promise<GeneratedThumbnail[]> {
  const bitmap = await createImageBitmap(file);
  const results: GeneratedThumbnail[] = [];
  try {
    for (const size of sizes) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d canvas context unavailable");
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
          "image/webp",
          0.82
        );
      });
      results.push({ size: size as ThumbnailSize, blob });
    }
  } finally {
    bitmap.close();
  }
  return results;
}

let nextRequestId = 0;

/**
 * Generate 320/800/1600px webp thumbnails from an image file, or from a
 * still-frame Blob (e.g. a captured video poster frame — see
 * lib/media/video.ts) — same resize pipeline either way.
 */
export async function generateThumbnails(
  file: File | Blob,
  sizes: readonly number[] = THUMBNAIL_SIZES
): Promise<GeneratedThumbnail[]> {
  const worker = getWorker();
  if (!worker) {
    return generateViaMainThreadCanvas(file, sizes);
  }

  const id = String(++nextRequestId);
  try {
    return await new Promise<GeneratedThumbnail[]>((resolve, reject) => {
      function onMessage(e: MessageEvent) {
        if (e.data?.id !== id) return;
        worker!.removeEventListener("message", onMessage);
        worker!.removeEventListener("error", onError);
        if (e.data.ok) resolve(e.data.results as GeneratedThumbnail[]);
        else reject(new Error(e.data.error ?? "thumbnail worker failed"));
      }
      function onError(err: ErrorEvent) {
        worker!.removeEventListener("message", onMessage);
        worker!.removeEventListener("error", onError);
        reject(err.error ?? new Error("thumbnail worker error"));
      }
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ id, file, sizes: [...sizes] });
    });
  } catch {
    // Worker path failed for some reason (unsupported codec, crash, etc.) —
    // fall back to the main thread rather than failing the whole upload.
    return generateViaMainThreadCanvas(file, sizes);
  }
}
