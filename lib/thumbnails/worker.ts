// Web Worker: generates resized webp thumbnails off the main thread using
// OffscreenCanvas. Falls back to main-thread generation (see index.ts) when
// OffscreenCanvas/Worker isn't available in the environment.

import { probeImageDimensions, computeResizeOption } from "./imageDimensions";
import { ThumbnailDecodeError } from "./errors";

export {};

interface ThumbRequest {
  id: string;
  file: File | Blob;
  sizes: number[];
}

interface ThumbResult {
  size: number;
  blob: Blob;
}

/**
 * Decodes `file` into an ImageBitmap. When the file's real dimensions can be
 * cheaply read from its header and its longest side exceeds the largest
 * thumbnail size needed, a resize hint is passed to createImageBitmap so the
 * browser downsamples *during* decode instead of allocating a full-resolution
 * pixel buffer first — this is what keeps very large photos from blowing
 * decode memory (the likely cause of "InvalidStateError: The source image
 * could not be decoded" on large images). Small/unrecognized-format images
 * are decoded as-is so they're never upscaled or altered.
 */
async function decodeBitmap(file: File | Blob, sizes: number[]): Promise<ImageBitmap> {
  const maxSize = sizes.length ? Math.max(...sizes) : 0;
  const dims = await probeImageDimensions(file);
  const resizeOption = dims ? computeResizeOption(dims, maxSize) : null;
  try {
    return resizeOption
      ? await createImageBitmap(file, { ...resizeOption, resizeQuality: "medium" })
      : await createImageBitmap(file);
  } catch (err) {
    throw new ThumbnailDecodeError("Unable to decode image in thumbnail worker", { cause: err });
  }
}

self.onmessage = async (e: MessageEvent<ThumbRequest>) => {
  const { id, file, sizes } = e.data;
  try {
    const bitmap = await decodeBitmap(file, sizes);
    const results: ThumbResult[] = [];
    try {
      for (const size of sizes) {
        const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("2d context unavailable in worker");
        ctx.drawImage(bitmap, 0, 0, w, h);
        const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
        results.push({ size, blob });
      }
    } finally {
      bitmap.close();
    }
    (self as unknown as Worker).postMessage({ id, ok: true, results });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      decodeError: err instanceof ThumbnailDecodeError,
    });
  }
};
