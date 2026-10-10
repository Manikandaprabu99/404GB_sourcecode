// Per-pixel color pipeline shared by the live preview and the full-resolution export:
// tone LUT (exposure, contrast) -> 3x4 color matrix (saturation, sepia, white balance)
// -> per-channel curves (S-curve, fade, split toning) -> vignette. Pure math on RGBA
// buffers, so it runs unchanged on the main thread and in the export worker.

import { NEUTRAL_LOOK, REC709, type Look, type Rgb } from "./filters";

const TONE_SIZE = 256;
const CURVE_SIZE = 1024;
// Curve index = channel value (0..255) * 4, so curves see sub-8-bit precision from the matrix.
const CURVE_SCALE = 4;
const CURVE_MAX_INDEX = CURVE_SIZE - 1;
const VIGNETTE_SIZE = 1024;
// Vignette index = squared normalized radius (0 at the center, 2 at the corners) * scale.
const VIGNETTE_SCALE = (VIGNETTE_SIZE - 1) / 2;
const EPSILON = 1e-4;

const SEPIA = [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131];

export interface ColorProgram {
  identity: boolean;
  tone: Float32Array;
  matrix: Float32Array | null;
  curves: [Float32Array, Float32Array, Float32Array] | null;
  vignette: Float32Array | null;
  vignetteLightens: boolean;
}

/** Where the vignette is centered, in the processed buffer's pixel coordinates. */
export interface VignetteFrame {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function toneValue(x: number, exposure: number, contrast: number): number {
  let y = x;
  if (exposure > 0) y = Math.pow(y, 1 / (1 + 1.2 * exposure));
  else if (exposure < 0) y = Math.pow(y, 1 - 1.2 * exposure);
  if (contrast > 0) {
    const p = 1 + 2 * contrast;
    y = y < 0.5 ? 0.5 * Math.pow(2 * y, p) : 1 - 0.5 * Math.pow(2 * (1 - y), p);
  } else if (contrast < 0) {
    y = 0.5 + (y - 0.5) * (1 + 0.75 * contrast);
  }
  return clamp01(y) * 255;
}

function buildTone(look: Look): Float32Array {
  const lut = new Float32Array(TONE_SIZE);
  for (let i = 0; i < TONE_SIZE; i++) lut[i] = toneValue(i / 255, look.exposure, look.contrast);
  return lut;
}

function multiply3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

function buildMatrix(look: Look): Float32Array | null {
  const { saturation, sepia, warmth, tint } = look;
  if (Math.abs(saturation) < EPSILON && sepia < EPSILON && Math.abs(warmth) < EPSILON && Math.abs(tint) < EPSILON) {
    return null;
  }
  const mix: Rgb = look.grayMix ?? REC709;
  const total = mix[0] + mix[1] + mix[2] || 1;
  const w = [mix[0] / total, mix[1] / total, mix[2] / total];
  const s = 1 + saturation;
  const saturate = [
    (1 - s) * w[0] + s, (1 - s) * w[1], (1 - s) * w[2],
    (1 - s) * w[0], (1 - s) * w[1] + s, (1 - s) * w[2],
    (1 - s) * w[0], (1 - s) * w[1], (1 - s) * w[2] + s,
  ];
  const tone = SEPIA.map((value, i) => sepia * value + (i % 4 === 0 ? 1 - sepia : 0));
  const color = multiply3(tone, saturate);
  const gains = [1 + 0.12 * warmth + 0.02 * tint, (1 + 0.025 * warmth) * (1 - 0.08 * tint), 1 - 0.12 * warmth + 0.02 * tint];
  const offsets = [10 * warmth, 2.5 * warmth, -10 * warmth];
  const matrix = new Float32Array(12);
  for (let r = 0; r < 3; r++) {
    matrix[r * 4] = color[r * 3] * gains[r];
    matrix[r * 4 + 1] = color[r * 3 + 1] * gains[r];
    matrix[r * 4 + 2] = color[r * 3 + 2] * gains[r];
    matrix[r * 4 + 3] = offsets[r];
  }
  return matrix;
}

function curveValue(x: number, look: Look, channel: number): number {
  let y = x;
  if (look.curve) y += look.curve * (y * y * (3 - 2 * y) - y);
  if (look.fade) {
    const lift = look.fade * 0.25 * look.fadeColor[channel];
    const drop = look.fade * 0.08;
    y = lift + y * (1 - lift - drop);
  }
  const shadow = look.shadows[channel];
  const highlight = look.highlights[channel];
  if (shadow) y += shadow * (1 - y) * (1 - y);
  if (highlight) y += highlight * y * y;
  return clamp01(y) * 255;
}

function buildCurves(look: Look): [Float32Array, Float32Array, Float32Array] | null {
  const split = [...look.shadows, ...look.highlights].some((v) => Math.abs(v) > EPSILON);
  if (look.fade < EPSILON && Math.abs(look.curve) < EPSILON && !split) return null;
  const channel = (c: number) => {
    const lut = new Float32Array(CURVE_SIZE);
    const last = 255 * CURVE_SCALE;
    for (let i = 0; i < CURVE_SIZE; i++) lut[i] = curveValue(Math.min(1, i / last), look, c);
    return lut;
  };
  return [channel(0), channel(1), channel(2)];
}

function buildVignette(amount: number): Float32Array | null {
  const strength = Math.abs(amount);
  if (strength < 1e-3) return null;
  const peak = amount > 0 ? 0.8 : 0.6;
  const lut = new Float32Array(VIGNETTE_SIZE);
  for (let i = 0; i < VIGNETTE_SIZE; i++) {
    const radius = Math.sqrt(i / VIGNETTE_SCALE / 2);
    lut[i] = strength * peak * smoothstep(0.32, 1.05, radius);
  }
  return lut;
}

export function buildColorProgram(look: Look): ColorProgram {
  const tone = buildTone(look);
  const matrix = buildMatrix(look);
  const curves = buildCurves(look);
  const vignette = buildVignette(look.vignette);
  const toneIsIdentity = Math.abs(look.exposure) < EPSILON && Math.abs(look.contrast) < EPSILON;
  return {
    identity: toneIsIdentity && !matrix && !curves && !vignette,
    tone,
    matrix,
    curves,
    vignette,
    vignetteLightens: look.vignette < 0,
  };
}

export const IDENTITY_PROGRAM: ColorProgram = buildColorProgram(NEUTRAL_LOOK);

/**
 * Applies `program` to `width` x `height` RGBA pixels from `src` into `dst` (may be the
 * same buffer). `rowOffset` is the first row's y within the full image when processing
 * in strips, so the vignette stays positioned on the whole frame.
 */
export function applyColorProgram(
  program: ColorProgram,
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  width: number,
  height: number,
  frame: VignetteFrame | null,
  rowOffset = 0
): void {
  const length = width * height * 4;
  if (program.identity) {
    if (src !== dst) dst.set(src.subarray(0, length));
    return;
  }
  const { tone, matrix: m, curves, vignette } = program;
  const lighten = program.vignetteLightens;
  const curveR = curves ? curves[0] : null;
  const curveG = curves ? curves[1] : null;
  const curveB = curves ? curves[2] : null;

  let dx2: Float32Array | null = null;
  if (vignette && frame && frame.rx > 0 && frame.ry > 0) {
    dx2 = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      const d = (x + 0.5 - frame.cx) / frame.rx;
      dx2[x] = d * d;
    }
  }

  let i = 0;
  for (let y = 0; y < height; y++) {
    let dy2 = 0;
    if (dx2 && frame) {
      const d = (y + rowOffset + 0.5 - frame.cy) / frame.ry;
      dy2 = d * d;
    }
    for (let x = 0; x < width; x++, i += 4) {
      let r = tone[src[i]];
      let g = tone[src[i + 1]];
      let b = tone[src[i + 2]];
      if (m) {
        const nr = m[0] * r + m[1] * g + m[2] * b + m[3];
        const ng = m[4] * r + m[5] * g + m[6] * b + m[7];
        const nb = m[8] * r + m[9] * g + m[10] * b + m[11];
        r = nr;
        g = ng;
        b = nb;
      }
      if (curveR && curveG && curveB) {
        let ri = (r * CURVE_SCALE) | 0;
        let gi = (g * CURVE_SCALE) | 0;
        let bi = (b * CURVE_SCALE) | 0;
        ri = ri < 0 ? 0 : ri > CURVE_MAX_INDEX ? CURVE_MAX_INDEX : ri;
        gi = gi < 0 ? 0 : gi > CURVE_MAX_INDEX ? CURVE_MAX_INDEX : gi;
        bi = bi < 0 ? 0 : bi > CURVE_MAX_INDEX ? CURVE_MAX_INDEX : bi;
        r = curveR[ri];
        g = curveG[gi];
        b = curveB[bi];
      }
      if (dx2 && vignette) {
        let vi = ((dx2[x] + dy2) * VIGNETTE_SCALE) | 0;
        if (vi > VIGNETTE_SIZE - 1) vi = VIGNETTE_SIZE - 1;
        const a = vignette[vi];
        if (lighten) {
          r += (255 - r) * a;
          g += (255 - g) * a;
          b += (255 - b) * a;
        } else {
          const k = 1 - a;
          r *= k;
          g *= k;
          b *= k;
        }
      }
      dst[i] = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = src[i + 3];
    }
  }
}
