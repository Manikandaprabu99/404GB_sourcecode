// Image decoding for the editor. Works in a Worker (ImageBitmap only) and on the
// main thread (adds an <img> fallback for files createImageBitmap rejects).

import type { ImageInfo } from "./imageInfo";
import type { Size } from "./types";

export interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Full upright size of the file, even when `image` was decoded smaller. */
  natural: Size;
  close(): void;
}

const ORIENTED: ImageBitmapOptions = { imageOrientation: "from-image" };

function closeTo(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= Math.max(2, expected * 0.01);
}

async function decodeBitmap(blob: Blob, maxLongSide: number | null, info: ImageInfo | null): Promise<ImageBitmap> {
  if (!maxLongSide || !info || Math.max(info.width, info.height) <= maxLongSide) {
    return createImageBitmap(blob, ORIENTED);
  }
  // A resize hint lets the decoder downsample while decoding instead of allocating full size first.
  const landscape = info.width >= info.height;
  const primary: ImageBitmapOptions = landscape ? { resizeWidth: maxLongSide } : { resizeHeight: maxLongSide };
  let bitmap = await createImageBitmap(blob, { ...ORIENTED, ...primary, resizeQuality: "high" });
  if (info.orientation >= 5 && !closeTo(Math.max(bitmap.width, bitmap.height), maxLongSide)) {
    // This engine resizes before applying the EXIF rotation, so the hint landed on the other axis.
    const alternate: ImageBitmapOptions = landscape ? { resizeHeight: maxLongSide } : { resizeWidth: maxLongSide };
    try {
      const retry = await createImageBitmap(blob, { ...ORIENTED, ...alternate, resizeQuality: "high" });
      if (closeTo(Math.max(retry.width, retry.height), maxLongSide)) {
        bitmap.close();
        bitmap = retry;
      } else {
        retry.close();
      }
    } catch {
      // Keep the first decode.
    }
  }
  return bitmap;
}

function fromBitmap(bitmap: ImageBitmap, natural: Size): DecodedImage {
  return { image: bitmap, width: bitmap.width, height: bitmap.height, natural, close: () => bitmap.close() };
}

async function decodeWithElement(blob: Blob, maxLongSide: number | null): Promise<DecodedImage> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  try {
    await img.decode();
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const natural = { width, height };
  if (!maxLongSide || Math.max(width, height) <= maxLongSide) {
    return { image: img, width, height, natural, close: () => URL.revokeObjectURL(url) };
  }
  const scale = maxLongSide / Math.max(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    throw new Error("Canvas is unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return {
    image: canvas,
    width: canvas.width,
    height: canvas.height,
    natural,
    close: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

export class ImageDecodeError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("This photo couldn't be opened for editing.", options);
    this.name = "ImageDecodeError";
  }
}

/** Decodes `blob` upright (EXIF orientation applied), no larger than `maxLongSide` when given. */
export async function decodeImage(
  blob: Blob,
  options: { maxLongSide?: number | null; info?: ImageInfo | null } = {}
): Promise<DecodedImage> {
  const maxLongSide = options.maxLongSide ?? null;
  const info = options.info ?? null;
  let bitmapError: unknown = null;
  if (typeof createImageBitmap === "function") {
    try {
      let bitmap = await decodeBitmap(blob, maxLongSide, info);
      // Without header info no resize hint was used, so this decode is the full size.
      const natural = info ? { width: info.width, height: info.height } : { width: bitmap.width, height: bitmap.height };
      // No usable header info (or the hint was ignored): downscale the full decode.
      if (maxLongSide && Math.max(bitmap.width, bitmap.height) > maxLongSide * 1.01) {
        const scale = maxLongSide / Math.max(bitmap.width, bitmap.height);
        const resized = await createImageBitmap(bitmap, {
          resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
          resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
          resizeQuality: "high",
        });
        bitmap.close();
        bitmap = resized;
      }
      return fromBitmap(bitmap, natural);
    } catch (err) {
      bitmapError = err;
    }
  }
  if (typeof document === "undefined") throw new ImageDecodeError({ cause: bitmapError });
  try {
    return await decodeWithElement(blob, maxLongSide);
  } catch (err) {
    throw new ImageDecodeError({ cause: err ?? bitmapError });
  }
}
