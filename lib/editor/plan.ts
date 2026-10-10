import { transformedSize } from "./geometry";
import type { EditState, Size } from "./types";

/** Longest side of a saved copy: keeps every canvas within mobile browsers' limits. */
export const EXPORT_MAX_SIDE = 4096;
/** Decoding budget for the export (~144 MB of RGBA); huge originals are decoded downscaled. */
export const EXPORT_MAX_DECODE_PIXELS = 36_000_000;

export interface ExportPlan {
  /** Pixel size of the saved copy. */
  output: Size;
  /** Longest side to decode the original at, or null for its natural size. */
  decodeLongSide: number | null;
  /** True when the copy has fewer pixels than the cropped original. */
  downscaled: boolean;
}

export function planExport(
  natural: Size,
  state: EditState,
  maxSide = EXPORT_MAX_SIDE,
  maxDecodePixels = EXPORT_MAX_DECODE_PIXELS
): ExportPlan {
  const frame = transformedSize(natural, state.rotation);
  const cropWidth = Math.max(1, state.crop.w * frame.width);
  const cropHeight = Math.max(1, state.crop.h * frame.height);
  const outputScale = Math.min(1, maxSide / Math.max(cropWidth, cropHeight));
  const decodeScale = Math.min(1, Math.sqrt(maxDecodePixels / Math.max(1, natural.width * natural.height)));
  const scale = Math.min(outputScale, decodeScale);
  const longSide = Math.max(natural.width, natural.height);
  return {
    output: {
      width: Math.min(maxSide, Math.max(1, Math.round(cropWidth * scale))),
      height: Math.min(maxSide, Math.max(1, Math.round(cropHeight * scale))),
    },
    decodeLongSide: scale < 1 ? Math.max(1, Math.ceil(longSide * scale)) : null,
    downscaled: scale < 0.9999,
  };
}
