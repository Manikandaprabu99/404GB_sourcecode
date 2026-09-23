// Client-side thumbnail generation. Prefers a Web Worker (OffscreenCanvas) so
// resizing large photos doesn't block the main thread; falls back to a
// synchronous <canvas> resize on the main thread if either isn't supported.

import { probeImageDimensions, computeResizeOption } from "./imageDimensions";
import { ThumbnailDecodeError } from "./errors";

export { ThumbnailDecodeError };

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

/** A decoded, drawable image source plus its real pixel dimensions and a way
 * to release any resources it holds (ImageBitmap needs `.close()`; an <img>
 * fallback needs its object URL revoked). Lets the resize loop below treat
 * either decode strategy identically. */
interface MainThreadSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

function decodeViaImgElement(file: File | Blob): Promise<MainThreadSource> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    img
      .decode()
      .then(() => {
        resolve({
          image: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          release: () => URL.revokeObjectURL(url),
        });
      })
      .catch((err) => {
        URL.revokeObjectURL(url);
        reject(err);
      });
  });
}

/**
 * Decodes `file` on the main thread, trying progressively more tolerant
 * strategies rather than failing the whole thumbnail as soon as the first
 * one throws:
 *
 *  1. createImageBitmap(), with a resize hint bounding the longest side to
 *     the largest thumbnail size needed when the source's real dimensions
 *     (read cheaply from its header, no decode) exceed that — this is what
 *     keeps very large/high-megapixel photos from exhausting decode memory.
 *  2. A plain <img> element + `.decode()`, drawn into a canvas — only
 *     possible on the main thread (Workers have no Image/document). This
 *     succeeds for some images createImageBitmap() rejects with
 *     "InvalidStateError: The source image could not be decoded", such as
 *     unusual color profiles/encodings.
 *
 * If both fail, throws a ThumbnailDecodeError so callers can tell "no
 * thumbnail was possible" apart from unrelated failures (network, API
 * errors) without string-matching.
 */
async function decodeMainThreadSource(
  file: File | Blob,
  sizes: readonly number[]
): Promise<MainThreadSource> {
  const maxSize = sizes.length ? Math.max(...sizes) : 0;
  const dims = await probeImageDimensions(file);
  const resizeOption = dims ? computeResizeOption(dims, maxSize) : null;

  try {
    const bitmap = resizeOption
      ? await createImageBitmap(file, { ...resizeOption, resizeQuality: "medium" })
      : await createImageBitmap(file);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch (bitmapErr) {
    try {
      return await decodeViaImgElement(file);
    } catch (imgErr) {
      throw new ThumbnailDecodeError("Unable to decode image for thumbnail generation", {
        cause: imgErr ?? bitmapErr,
      });
    }
  }
}

async function generateViaMainThreadCanvas(
  file: File | Blob,
  sizes: readonly number[]
): Promise<GeneratedThumbnail[]> {
  const source = await decodeMainThreadSource(file, sizes);
  const results: GeneratedThumbnail[] = [];
  try {
    for (const size of sizes) {
      const scale = Math.min(1, size / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * scale));
      const h = Math.max(1, Math.round(source.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d canvas context unavailable");
      ctx.drawImage(source.image, 0, 0, w, h);
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
    source.release();
  }
  return results;
}

let nextRequestId = 0;

/**
 * Generate 320/800/1600px webp thumbnails from an image file, or from a
 * still-frame Blob (e.g. a captured video poster frame — see
 * lib/media/video.ts) — same resize pipeline either way.
 *
 * Throws ThumbnailDecodeError when no decode strategy could produce a
 * thumbnail (rather than being fatal to the whole upload — see
 * lib/upload/uploadQueue.ts, which treats thumbnail generation as optional).
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
    // generateViaMainThreadCanvas throws ThumbnailDecodeError itself if every
    // main-thread strategy also fails, so that error propagates naturally.
    return generateViaMainThreadCanvas(file, sizes);
  }
}
