import { applyColorProgram, buildColorProgram } from "./color";
import { resolveLook } from "./filters";
import { cropPixels, regionMatrix, transformedSize } from "./geometry";
import type { EditState, Size } from "./types";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawingSurface {
  canvas: AnyCanvas;
  ctx: AnyContext2D;
}

// Rows per getImageData/putImageData pass, so a 4096px export never holds a second full-size buffer.
const STRIP_ROWS = 256;

/** A 2D canvas: OffscreenCanvas where it has a 2D context (always in workers), else a <canvas>. */
export function createSurface(width: number, height: number): DrawingSurface {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  throw new Error("This browser can't draw the edited photo.");
}

export function releaseSurface(surface: DrawingSurface): void {
  surface.canvas.width = 0;
  surface.canvas.height = 0;
}

export async function encodeSurface(surface: DrawingSurface, type: string, quality: number): Promise<Blob> {
  const { canvas } = surface;
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the edited photo."))),
      type,
      quality
    );
  });
}

function hasTransparentPixel(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return true;
  }
  return false;
}

export interface RenderedEdit {
  surface: DrawingSurface;
  hasTransparency: boolean;
}

/**
 * Draws `source` (already upright, `sourceSize` pixels) with the edit's rotation, flip
 * and crop into a canvas of `output` size, then applies the color pipeline in strips.
 */
export function renderEdit(
  source: CanvasImageSource,
  sourceSize: Size,
  state: EditState,
  output: Size,
  checkTransparency: boolean
): RenderedEdit {
  const surface = createSurface(output.width, output.height);
  const { ctx } = surface;
  const region = cropPixels(state.crop, transformedSize(sourceSize, state.rotation));
  const m = regionMatrix(sourceSize, state.rotation, state.flipH, region, output);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(source, 0, 0, sourceSize.width, sourceSize.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const program = buildColorProgram(resolveLook(state.filter, state.filterStrength, state.adjust));
  const frame = { cx: output.width / 2, cy: output.height / 2, rx: output.width / 2, ry: output.height / 2 };
  let hasTransparency = false;
  if (!program.identity || checkTransparency) {
    for (let y = 0; y < output.height; y += STRIP_ROWS) {
      const rows = Math.min(STRIP_ROWS, output.height - y);
      const strip = ctx.getImageData(0, y, output.width, rows);
      if (checkTransparency && !hasTransparency) hasTransparency = hasTransparentPixel(strip.data);
      if (!program.identity) {
        applyColorProgram(program, strip.data, strip.data, output.width, rows, frame, y);
        ctx.putImageData(strip, 0, y);
      }
    }
  }
  return { surface, hasTransparency };
}
