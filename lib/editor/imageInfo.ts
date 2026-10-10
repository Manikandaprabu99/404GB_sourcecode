import { probeImageDimensions } from "@/lib/thumbnails/imageDimensions";
import type { Size } from "./types";

export interface ImageInfo extends Size {
  /** EXIF orientation 1..8; width/height above already have it applied. */
  orientation: number;
}

const EXIF_PROBE_BYTES = 128 * 1024;

function readTiffOrientation(view: DataView, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const byteOrder = view.getUint16(tiff);
  const little = byteOrder === 0x4949;
  if (!little && byteOrder !== 0x4d4d) return null;
  if (view.getUint16(tiff + 2, little) !== 0x2a) return null;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return null;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** EXIF orientation of a JPEG (1 when it has none), or null if `buffer` isn't a JPEG. */
export function readJpegOrientation(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return 1;
    const length = view.getUint16(offset + 2);
    if (length < 2) return 1;
    const isExif =
      marker === 0xe1 &&
      offset + 10 <= view.byteLength &&
      view.getUint32(offset + 4) === 0x45786966 && // "Exif"
      view.getUint16(offset + 8) === 0;
    if (isExif) {
      return readTiffOrientation(view, offset + 10, Math.min(view.byteLength, offset + 2 + length)) ?? 1;
    }
    offset += 2 + length;
  }
  return 1;
}

/** Display size (EXIF orientation applied) from the file header alone; null if unknown. */
export async function readImageInfo(blob: Blob): Promise<ImageInfo | null> {
  const raw = await probeImageDimensions(blob);
  if (!raw) return null;
  let orientation = 1;
  try {
    orientation = readJpegOrientation(await blob.slice(0, EXIF_PROBE_BYTES).arrayBuffer()) ?? 1;
  } catch {
    // Unreadable header: assume upright.
  }
  const swap = orientation >= 5;
  return {
    width: swap ? raw.height : raw.width,
    height: swap ? raw.width : raw.height,
    orientation,
  };
}

/** Swaps `natural` when a decoder produced the other orientation (its pixels are the truth). */
export function alignToDecoded(natural: Size, decoded: Size): Size {
  const naturalLandscape = natural.width >= natural.height;
  const decodedLandscape = decoded.width >= decoded.height;
  const square = Math.abs(natural.width - natural.height) <= 1 || Math.abs(decoded.width - decoded.height) <= 1;
  if (square || naturalLandscape === decodedLandscape) return natural;
  return { width: natural.height, height: natural.width };
}
