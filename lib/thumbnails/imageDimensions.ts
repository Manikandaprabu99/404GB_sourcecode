// Cheap image dimension probing from a file's header bytes only — no pixel
// decode. This lets index.ts/worker.ts decide *before* calling
// createImageBitmap() whether a resize hint is needed to keep decode memory
// bounded for very large photos, without paying for a full decode just to
// find that out (which is the exact operation that can throw "InvalidState
// Error: The source image could not be decoded" for huge/unusual images in
// the first place).
//
// Returns null for anything it doesn't recognize (including formats it
// intentionally doesn't parse, like WebP's lossless VP8L bitstream) —
// callers treat "unknown" as "don't apply a resize hint" so an
// unrecognized-but-small image is never accidentally upscaled.

export interface ImageDimensions {
  width: number;
  height: number;
}

const PROBE_BYTES = 262144; // 256KiB — comfortably covers header/metadata for real photos

export async function probeImageDimensions(blob: Blob): Promise<ImageDimensions | null> {
  try {
    const buf = await blob.slice(0, PROBE_BYTES).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    return readPng(bytes, view) ?? readJpeg(bytes, view) ?? readGif(bytes, view) ?? readWebp(bytes, view);
  } catch {
    return null;
  }
}

/** Given real dimensions, returns the createImageBitmap resize option that
 * bounds the *longest* side to `maxSize`, preserving aspect ratio — or null
 * if the image is already at or under that size and shouldn't be touched. */
export function computeResizeOption(
  dims: ImageDimensions,
  maxSize: number
): { resizeWidth: number } | { resizeHeight: number } | null {
  if (maxSize <= 0) return null;
  const longest = Math.max(dims.width, dims.height);
  if (longest <= maxSize) return null;
  return dims.width >= dims.height ? { resizeWidth: maxSize } : { resizeHeight: maxSize };
}

function readPng(b: Uint8Array, view: DataView): ImageDimensions | null {
  if (b.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (b[i] !== sig[i]) return null;
  // IHDR is always the first chunk: 4-byte length, "IHDR", width(4), height(4).
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  return width && height ? { width, height } : null;
}

function readGif(b: Uint8Array, view: DataView): ImageDimensions | null {
  if (b.length < 10) return null;
  const isGif =
    b[0] === 0x47 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61;
  if (!isGif) return null;
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  return width && height ? { width, height } : null;
}

function readJpeg(b: Uint8Array, view: DataView): ImageDimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) return null;
    // Skip any 0xFF padding bytes before the real marker code.
    let markerOffset = offset + 1;
    while (b[markerOffset] === 0xff && markerOffset + 1 < b.length) markerOffset++;
    const marker = b[markerOffset];
    offset = markerOffset + 1;
    if (marker === 0xd9) break; // EOI
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue; // no-payload markers
    if (offset + 2 > b.length) break;
    const length = view.getUint16(offset, false);
    const isSof = (marker & 0xf0) === 0xc0 && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (offset + 7 > b.length) return null;
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      return width && height ? { width, height } : null;
    }
    if (marker === 0xda) break; // start of scan — no more headers before entropy-coded data
    if (length < 2) break; // malformed — bail out rather than loop forever
    offset += length;
  }
  return null;
}

function readWebp(b: Uint8Array, view: DataView): ImageDimensions | null {
  if (b.length < 30) return null;
  const isRiff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const isWebp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (!isRiff || !isWebp) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === "VP8X") {
    // Extended format: 24-bit little-endian canvas width/height, minus one.
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return width && height ? { width, height } : null;
  }
  if (fourcc === "VP8 ") {
    // Simple lossy bitstream: 3-byte start code, then 14-bit width/height
    // (top 2 bits of each are a scale factor we don't need).
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return width && height ? { width, height } : null;
  }
  // VP8L (lossless) and anything else: not parsed — treat as unknown.
  return null;
}
