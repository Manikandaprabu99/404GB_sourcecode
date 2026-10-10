// Screen-resolution preview. The geometry pass (rotate/flip/crop + resample) is cached,
// so moving a slider only re-runs the per-pixel color pass on the cached pixels.

import { applyColorProgram, buildColorProgram, IDENTITY_PROGRAM, type ColorProgram, type VignetteFrame } from "./color";
import { resolveLook } from "./filters";
import { cropPixels, regionMatrix, transformedSize } from "./geometry";
import type { CropRect, EditState, Size } from "./types";

export interface PreviewSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  /** Changes whenever `image` does (thumbnail -> original). */
  id: string;
}

/** "full" shows the whole rotated picture (crop mode); "crop" shows only the crop. */
export type PreviewRegion = "full" | "crop";

const BASE_CACHE_SLOTS = 3;

export function cropKey(crop: CropRect): string {
  return `${crop.x.toFixed(5)},${crop.y.toFixed(5)},${crop.w.toFixed(5)},${crop.h.toFixed(5)}`;
}

/** The vignette always follows the crop, even while the whole picture is shown. */
export function vignetteFrameFor(region: PreviewRegion, crop: CropRect, size: Size): VignetteFrame {
  if (region === "crop") {
    return { cx: size.width / 2, cy: size.height / 2, rx: size.width / 2, ry: size.height / 2 };
  }
  return {
    cx: (crop.x + crop.w / 2) * size.width,
    cy: (crop.y + crop.h / 2) * size.height,
    rx: (crop.w / 2) * size.width,
    ry: (crop.h / 2) * size.height,
  };
}

/** Pixel size of the region of `source` that the preview shows. */
export function previewRegionSize(source: Size, state: EditState, region: PreviewRegion): Size {
  const frame = transformedSize(source, state.rotation);
  if (region === "full") return frame;
  const rect = cropPixels(state.crop, frame);
  return { width: rect.width, height: rect.height };
}

function drawRegion(
  ctx: CanvasRenderingContext2D,
  source: PreviewSource,
  state: EditState,
  region: PreviewRegion,
  output: Size
): void {
  const sourceSize = { width: source.width, height: source.height };
  const frame = transformedSize(sourceSize, state.rotation);
  const rect =
    region === "full" ? { x: 0, y: 0, width: frame.width, height: frame.height } : cropPixels(state.crop, frame);
  const m = regionMatrix(sourceSize, state.rotation, state.flipH, rect, output);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, output.width, output.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(source.image, 0, 0, source.width, source.height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export class PreviewRenderer {
  private work: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
  private bases: Array<{ key: string; data: ImageData }> = [];
  private output: ImageData | null = null;
  private program: { key: string; value: ColorProgram } | null = null;
  /** Duration of the last full-resolution render, used to decide on draft renders. */
  lastRenderMs = 0;

  private workSurface(size: Size): CanvasRenderingContext2D {
    if (!this.work) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas is unavailable");
      this.work = { canvas, ctx };
    }
    const { canvas, ctx } = this.work;
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    return ctx;
  }

  private base(source: PreviewSource, state: EditState, region: PreviewRegion, size: Size): ImageData {
    const key = [
      source.id,
      state.rotation,
      state.flipH ? 1 : 0,
      region === "crop" ? cropKey(state.crop) : "full",
      size.width,
      size.height,
    ].join("|");
    const hit = this.bases.find((entry) => entry.key === key);
    if (hit) return hit.data;
    const ctx = this.workSurface(size);
    drawRegion(ctx, source, state, region, size);
    const data = ctx.getImageData(0, 0, size.width, size.height);
    this.bases = [{ key, data }, ...this.bases].slice(0, BASE_CACHE_SLOTS);
    return data;
  }

  private colorProgram(state: EditState): ColorProgram {
    const look = resolveLook(state.filter, state.filterStrength, state.adjust);
    const key = JSON.stringify(look);
    if (this.program?.key !== key) this.program = { key, value: buildColorProgram(look) };
    return this.program.value;
  }

  render(
    target: HTMLCanvasElement,
    source: PreviewSource,
    state: EditState,
    options: { region: PreviewRegion; size: Size; color: boolean; draft: boolean }
  ): void {
    const started = performance.now();
    const { size, region } = options;
    const base = this.base(source, state, region, size);
    const program = options.color ? this.colorProgram(state) : IDENTITY_PROGRAM;
    if (!this.output || this.output.width !== size.width || this.output.height !== size.height) {
      this.output = new ImageData(size.width, size.height);
    }
    applyColorProgram(program, base.data, this.output.data, size.width, size.height, vignetteFrameFor(region, state.crop, size));
    if (target.width !== size.width || target.height !== size.height) {
      target.width = size.width;
      target.height = size.height;
    }
    target.getContext("2d")?.putImageData(this.output, 0, 0);
    if (!options.draft) this.lastRenderMs = performance.now() - started;
  }

  dispose(): void {
    this.bases = [];
    this.output = null;
    if (this.work) {
      this.work.canvas.width = 0;
      this.work.canvas.height = 0;
      this.work = null;
    }
  }
}

/** A square center crop of the edited picture, for filter thumbnails. */
export function renderSquareBase(source: PreviewSource, state: EditState, size: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas is unavailable");
  const sourceSize = { width: source.width, height: source.height };
  const frame = transformedSize(sourceSize, state.rotation);
  const crop = cropPixels(state.crop, frame);
  const side = Math.min(crop.width, crop.height);
  const square = { x: crop.x + (crop.width - side) / 2, y: crop.y + (crop.height - side) / 2, width: side, height: side };
  const m = regionMatrix(sourceSize, state.rotation, state.flipH, square, { width: size, height: size });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  ctx.drawImage(source.image, 0, 0, source.width, source.height);
  return ctx.getImageData(0, 0, size, size);
}
