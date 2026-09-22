// Web Worker: generates resized webp thumbnails off the main thread using
// OffscreenCanvas. Falls back to main-thread generation (see index.ts) when
// OffscreenCanvas/Worker isn't available in the environment.

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

self.onmessage = async (e: MessageEvent<ThumbRequest>) => {
  const { id, file, sizes } = e.data;
  try {
    const bitmap = await createImageBitmap(file);
    const results: ThumbResult[] = [];
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
    bitmap.close();
    (self as unknown as Worker).postMessage({ id, ok: true, results });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
