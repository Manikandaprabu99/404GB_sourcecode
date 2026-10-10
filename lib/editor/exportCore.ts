import { decodeImage } from "./decode";
import { alignToDecoded, readImageInfo } from "./imageInfo";
import { planExport } from "./plan";
import { encodeSurface, releaseSurface, renderEdit } from "./render";
import type { EditState, Size } from "./types";

export interface ExportRequest {
  blob: Blob;
  mimeType: string;
  state: EditState;
  /** Upright pixel size of the original, when already known. */
  natural: Size | null;
}

export interface ExportResult {
  blob: Blob;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

const JPEG_QUALITY = 0.92;
const ALPHA_CAPABLE = /^image\/(png|webp|gif|avif)$/i;

/** Renders the edit at full (capped) resolution and encodes it. Runs in the export worker or on the main thread. */
export async function exportEdit(request: ExportRequest): Promise<ExportResult> {
  const info = await readImageInfo(request.blob);
  let natural = request.natural ?? info;
  let decoded = natural ? null : await decodeImage(request.blob, { info });
  if (decoded) natural = decoded.natural;
  if (!natural) throw new Error("This photo couldn't be opened for editing.");

  let plan = planExport(natural, request.state);
  if (!decoded) decoded = await decodeImage(request.blob, { maxLongSide: plan.decodeLongSide, info });
  try {
    const sourceSize = { width: decoded.width, height: decoded.height };
    const aligned = alignToDecoded(natural, sourceSize);
    if (aligned !== natural) plan = planExport(aligned, request.state);

    const rendered = renderEdit(decoded.image, sourceSize, request.state, plan.output, ALPHA_CAPABLE.test(request.mimeType));
    decoded.close();
    try {
      const mimeType = rendered.hasTransparency ? "image/png" : "image/jpeg";
      const blob = await encodeSurface(rendered.surface, mimeType, JPEG_QUALITY);
      return { blob, mimeType, width: plan.output.width, height: plan.output.height };
    } finally {
      releaseSurface(rendered.surface);
    }
  } finally {
    decoded.close();
  }
}
