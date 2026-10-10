export const FILTER_IDS = [
  "original",
  "vivid",
  "warm",
  "cool",
  "mono",
  "noir",
  "vintage",
  "fade",
  "dramatic",
] as const;
export type FilterId = (typeof FILTER_IDS)[number];

export const ADJUSTMENT_IDS = ["brightness", "contrast", "saturation", "warmth", "vignette"] as const;
export type AdjustmentId = (typeof ADJUSTMENT_IDS)[number];
/** Each value is -100..100, 0 = unchanged. */
export type Adjustments = Record<AdjustmentId, number>;

export const ASPECT_IDS = ["free", "original", "1:1", "4:3", "3:4", "16:9", "9:16"] as const;
export type AspectId = (typeof ASPECT_IDS)[number];

export type QuarterTurns = 0 | 1 | 2 | 3;

export interface Size {
  width: number;
  height: number;
}

/** A rectangle normalized to 0..1 on both axes. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditState {
  filter: FilterId;
  /** 0..100 — how strongly the filter preset applies. */
  filterStrength: number;
  adjust: Adjustments;
  /** Clockwise quarter turns, applied before the horizontal flip. */
  rotation: QuarterTurns;
  flipH: boolean;
  /** Normalized to the rotated and flipped image. */
  crop: CropRect;
  aspect: AspectId;
}

export const FULL_CROP: Readonly<CropRect> = { x: 0, y: 0, w: 1, h: 1 };

export const NEUTRAL_ADJUSTMENTS: Readonly<Adjustments> = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  vignette: 0,
};

export function createEditState(): EditState {
  return {
    filter: "original",
    filterStrength: 100,
    adjust: { ...NEUTRAL_ADJUSTMENTS },
    rotation: 0,
    flipH: false,
    crop: { ...FULL_CROP },
    aspect: "free",
  };
}

const EPSILON = 1e-4;

export function isFullCrop(crop: CropRect): boolean {
  return (
    Math.abs(crop.x) < EPSILON &&
    Math.abs(crop.y) < EPSILON &&
    Math.abs(crop.w - 1) < EPSILON &&
    Math.abs(crop.h - 1) < EPSILON
  );
}

export function hasAdjustments(adjust: Adjustments): boolean {
  return ADJUSTMENT_IDS.some((id) => adjust[id] !== 0);
}

export function hasColorEdits(state: EditState): boolean {
  return (state.filter !== "original" && state.filterStrength > 0) || hasAdjustments(state.adjust);
}

export function hasGeometryEdits(state: EditState): boolean {
  return state.rotation !== 0 || state.flipH || !isFullCrop(state.crop);
}

export function isEdited(state: EditState): boolean {
  return hasColorEdits(state) || hasGeometryEdits(state);
}
