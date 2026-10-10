import type { AspectId, CropRect, EditState, QuarterTurns, Size } from "./types";

/** Canvas-style affine transform: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export type CropHandle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function transformedSize(size: Size, rotation: QuarterTurns): Size {
  return rotation % 2 === 1 ? { width: size.height, height: size.width } : { ...size };
}

/** `outer` applied after `inner`. */
export function compose(outer: Matrix2D, inner: Matrix2D): Matrix2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Maps source pixels to the rotated (clockwise) and then horizontally flipped frame. */
export function orientationMatrix(size: Size, rotation: QuarterTurns, flipH: boolean): Matrix2D {
  const { width: w, height: h } = size;
  const rotations: Record<QuarterTurns, Matrix2D> = {
    0: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    1: { a: 0, b: 1, c: -1, d: 0, e: h, f: 0 },
    2: { a: -1, b: 0, c: 0, d: -1, e: w, f: h },
    3: { a: 0, b: -1, c: 1, d: 0, e: 0, f: w },
  };
  const rotate = rotations[rotation];
  if (!flipH) return rotate;
  const frame = transformedSize(size, rotation);
  return compose({ a: -1, b: 0, c: 0, d: 1, e: frame.width, f: 0 }, rotate);
}

/** Source pixels -> output pixels for the `region` (in transformed-frame pixels) drawn at `output` size. */
export function regionMatrix(
  size: Size,
  rotation: QuarterTurns,
  flipH: boolean,
  region: PixelRect,
  output: Size
): Matrix2D {
  const sx = output.width / region.width;
  const sy = output.height / region.height;
  return compose(
    { a: sx, b: 0, c: 0, d: sy, e: -region.x * sx, f: -region.y * sy },
    orientationMatrix(size, rotation, flipH)
  );
}

/** The crop in frame pixels, clamped inside the frame so the picture always covers it edge to edge. */
export function cropPixels(crop: CropRect, frame: Size): PixelRect {
  const x = clamp(crop.x * frame.width, 0, frame.width - 1);
  const y = clamp(crop.y * frame.height, 0, frame.height - 1);
  return {
    x,
    y,
    width: clamp(crop.w * frame.width, 1, frame.width - x),
    height: clamp(crop.h * frame.height, 1, frame.height - y),
  };
}

/** The crop as seen after turning the whole picture a quarter turn (1 = clockwise). */
export function rotateCrop(crop: CropRect, direction: 1 | -1): CropRect {
  return direction === 1
    ? { x: 1 - crop.y - crop.h, y: crop.x, w: crop.h, h: crop.w }
    : { x: crop.y, y: 1 - crop.x - crop.w, w: crop.h, h: crop.w };
}

export function flipCrop(crop: CropRect): CropRect {
  return { x: 1 - crop.x - crop.w, y: crop.y, w: crop.w, h: crop.h };
}

const SWAPPED_ASPECT: Partial<Record<AspectId, AspectId>> = {
  "4:3": "3:4",
  "3:4": "4:3",
  "16:9": "9:16",
  "9:16": "16:9",
};

/** Turns the displayed picture a quarter turn; the crop and its aspect turn with it. */
export function rotateEdit(state: EditState, direction: 1 | -1): EditState {
  // Mirroring reverses the sense of rotation, so a flipped image turns the stored rotation the other way.
  const step = state.flipH ? -direction : direction;
  return {
    ...state,
    rotation: (((state.rotation + step) % 4) + 4) % 4 as QuarterTurns,
    crop: rotateCrop(state.crop, direction),
    aspect: SWAPPED_ASPECT[state.aspect] ?? state.aspect,
  };
}

export function flipEdit(state: EditState): EditState {
  return { ...state, flipH: !state.flipH, crop: flipCrop(state.crop) };
}

const ASPECT_RATIOS: Partial<Record<AspectId, number>> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

/** Width / height in pixels for `aspect`, or null when the crop is free-form. */
export function aspectRatio(aspect: AspectId, frame: Size): number | null {
  if (aspect === "free") return null;
  if (aspect === "original") return frame.width / frame.height;
  return ASPECT_RATIOS[aspect] ?? null;
}

/** The largest crop of `ratio` that fits the frame, centered on the current crop. */
export function fitCropToAspect(crop: CropRect, ratio: number, frame: Size): CropRect {
  const fw = frame.width;
  const fh = frame.height;
  let w = fw;
  let h = fw / ratio;
  if (h > fh) {
    h = fh;
    w = fh * ratio;
  }
  const cx = (crop.x + crop.w / 2) * fw;
  const cy = (crop.y + crop.h / 2) * fh;
  const x = clamp(cx - w / 2, 0, fw - w);
  const y = clamp(cy - h / 2, 0, fh - h);
  return { x: x / fw, y: y / fh, w: w / fw, h: h / fh };
}

/**
 * Applies a drag of (dx, dy) frame pixels on `handle` to the crop as it was when the
 * drag started. Keeps the crop inside the frame, at least `minSize` pixels on each side,
 * and at `ratio` (width / height) when one is set.
 */
export function dragCrop(
  start: CropRect,
  handle: CropHandle,
  dx: number,
  dy: number,
  frame: Size,
  ratio: number | null,
  minSize: number
): CropRect {
  const fw = frame.width;
  const fh = frame.height;
  const x = start.x * fw;
  const y = start.y * fh;
  const w = start.w * fw;
  const h = start.h * fh;
  const min = Math.min(minSize, fw, fh);

  let left = x;
  let top = y;
  let right = x + w;
  let bottom = y + h;

  if (handle === "move") {
    left = clamp(x + dx, 0, fw - w);
    top = clamp(y + dy, 0, fh - h);
    right = left + w;
    bottom = top + h;
  } else if (ratio === null) {
    if (handle.includes("e")) right = clamp(right + dx, left + min, fw);
    if (handle.includes("w")) left = clamp(left + dx, 0, right - min);
    if (handle.includes("s")) bottom = clamp(bottom + dy, top + min, fh);
    if (handle.includes("n")) top = clamp(top + dy, 0, bottom - min);
  } else if (handle.length === 2) {
    // Corner with a locked ratio: project the pointer onto the diagonal through the anchored corner.
    const east = handle.includes("e");
    const south = handle.includes("s");
    const anchorX = east ? left : right;
    const anchorY = south ? top : bottom;
    // Measure along the locked ratio even if the starting crop isn't exactly at it.
    const baseW = w;
    const baseH = w / ratio;
    const wantW = w + (east ? dx : -dx);
    const wantH = h + (south ? dy : -dy);
    let t = (wantW * baseW + wantH * baseH) / (baseW * baseW + baseH * baseH);
    const maxT = Math.min((east ? fw - anchorX : anchorX) / baseW, (south ? fh - anchorY : anchorY) / baseH);
    const minT = Math.min(maxT, Math.max(min / baseW, min / baseH));
    t = clamp(t, minT, maxT);
    const nw = baseW * t;
    const nh = baseH * t;
    left = east ? anchorX : anchorX - nw;
    top = south ? anchorY : anchorY - nh;
    right = left + nw;
    bottom = top + nh;
  } else if (handle === "e" || handle === "w") {
    // Edge with a locked ratio: the other axis grows symmetrically about the crop's center.
    const east = handle === "e";
    const maxW = Math.min(east ? fw - left : right, fh * ratio);
    const nw = clamp(w + (east ? dx : -dx), Math.min(maxW, Math.max(min, min * ratio)), maxW);
    const nh = nw / ratio;
    if (east) right = left + nw;
    else left = right - nw;
    top = clamp(y + h / 2 - nh / 2, 0, fh - nh);
    bottom = top + nh;
  } else {
    const south = handle === "s";
    const maxH = Math.min(south ? fh - top : bottom, fw / ratio);
    const nh = clamp(h + (south ? dy : -dy), Math.min(maxH, Math.max(min, min / ratio)), maxH);
    const nw = nh * ratio;
    if (south) bottom = top + nh;
    else top = bottom - nh;
    left = clamp(x + w / 2 - nw / 2, 0, fw - nw);
    right = left + nw;
  }

  return { x: left / fw, y: top / fh, w: (right - left) / fw, h: (bottom - top) / fh };
}
