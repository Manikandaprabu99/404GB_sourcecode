import type { AdjustmentId, Adjustments, FilterId } from "./types";

export type Rgb = readonly [number, number, number];

/** One parameter space shared by the filter presets and the Adjust sliders, so a
 * preset's strength and the user's adjustments simply add up. */
export interface Look {
  /** -1..1, a midtone (gamma) lift or drop. */
  exposure: number;
  /** -1..1, an S-curve above zero, a flatter curve below. */
  contrast: number;
  /** -1..1, -1 is fully desaturated. */
  saturation: number;
  /** -1..1, cool (blue) to warm (amber) white balance. */
  warmth: number;
  /** -1..1, green to magenta. */
  tint: number;
  /** 0..1, lifted blacks and softened whites. */
  fade: number;
  /** Per-channel weight of the fade lift (1,1,1 is neutral). */
  fadeColor: Rgb;
  /** -1..1, an extra smooth S-curve applied after the color mix. */
  curve: number;
  /** 0..1, blend toward a sepia tone. */
  sepia: number;
  /** -1..1, darkens (positive) or lightens (negative) the corners. */
  vignette: number;
  /** Per-channel push added in the shadows / highlights (split toning). */
  shadows: Rgb;
  highlights: Rgb;
  /** Luminance weights used when desaturating (a "color filter" for black & white). */
  grayMix: Rgb | null;
}

export const REC709: Rgb = [0.2126, 0.7152, 0.0722];

export const NEUTRAL_LOOK: Readonly<Look> = {
  exposure: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  fade: 0,
  fadeColor: [1, 1, 1],
  curve: 0,
  sepia: 0,
  vignette: 0,
  shadows: [0, 0, 0],
  highlights: [0, 0, 0],
  grayMix: null,
};

export interface FilterPreset {
  id: FilterId;
  label: string;
  look: Partial<Look>;
}

export const FILTER_PRESETS: readonly FilterPreset[] = [
  { id: "original", label: "Original", look: {} },
  {
    id: "vivid",
    label: "Vivid",
    look: { saturation: 0.38, contrast: 0.16, exposure: 0.03, curve: 0.08 },
  },
  {
    id: "warm",
    label: "Warm",
    look: { warmth: 0.58, saturation: 0.08, exposure: 0.04, highlights: [0.03, 0.015, -0.03] },
  },
  {
    id: "cool",
    label: "Cool",
    look: { warmth: -0.52, tint: -0.03, contrast: 0.06, saturation: -0.04, shadows: [-0.02, 0.01, 0.06] },
  },
  {
    id: "mono",
    label: "Mono",
    look: { saturation: -1, contrast: 0.1, grayMix: REC709 },
  },
  {
    id: "noir",
    label: "Noir",
    look: {
      saturation: -1,
      contrast: 0.42,
      curve: 0.3,
      exposure: -0.08,
      vignette: 0.42,
      grayMix: [0.45, 0.45, 0.1],
    },
  },
  {
    id: "vintage",
    label: "Vintage",
    look: {
      sepia: 0.42,
      saturation: -0.2,
      warmth: 0.14,
      fade: 0.34,
      fadeColor: [1.15, 0.95, 0.7],
      contrast: -0.06,
      vignette: 0.3,
      highlights: [0.02, 0.01, -0.03],
    },
  },
  {
    id: "fade",
    label: "Fade",
    look: { fade: 0.44, contrast: -0.16, saturation: -0.24, exposure: 0.05 },
  },
  {
    id: "dramatic",
    label: "Dramatic",
    look: {
      contrast: 0.34,
      curve: 0.28,
      saturation: -0.14,
      exposure: -0.05,
      vignette: 0.34,
      warmth: -0.06,
      shadows: [-0.01, 0, 0.02],
    },
  },
];

export interface AdjustmentDef {
  id: AdjustmentId;
  label: string;
}

export const ADJUSTMENTS: readonly AdjustmentDef[] = [
  { id: "brightness", label: "Brightness" },
  { id: "contrast", label: "Contrast" },
  { id: "saturation", label: "Saturation" },
  { id: "warmth", label: "Warmth" },
  { id: "vignette", label: "Vignette" },
];

export function filterPreset(id: FilterId): FilterPreset {
  return FILTER_PRESETS.find((preset) => preset.id === id) ?? FILTER_PRESETS[0];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scaleRgb(rgb: Rgb, by: number): Rgb {
  return [rgb[0] * by, rgb[1] * by, rgb[2] * by];
}

/** The preset at `strength` (0..100) combined with the user's adjustments. */
export function resolveLook(filter: FilterId, strength: number, adjust: Adjustments): Look {
  const preset = filterPreset(filter).look;
  const s = clamp(strength / 100, 0, 1);
  const p = (key: "exposure" | "contrast" | "saturation" | "warmth" | "tint" | "fade" | "curve" | "sepia" | "vignette") =>
    (preset[key] ?? 0) * s;
  return {
    exposure: clamp(p("exposure") + adjust.brightness / 100, -1, 1),
    contrast: clamp(p("contrast") + adjust.contrast / 100, -1, 1),
    saturation: clamp(p("saturation") + adjust.saturation / 100, -1, 1),
    warmth: clamp(p("warmth") + adjust.warmth / 100, -1, 1),
    tint: clamp(p("tint"), -1, 1),
    fade: clamp(p("fade"), 0, 1),
    fadeColor: preset.fadeColor ?? NEUTRAL_LOOK.fadeColor,
    curve: clamp(p("curve"), -1, 1),
    sepia: clamp(p("sepia"), 0, 1),
    vignette: clamp(p("vignette") + adjust.vignette / 100, -1, 1),
    shadows: scaleRgb(preset.shadows ?? NEUTRAL_LOOK.shadows, s),
    highlights: scaleRgb(preset.highlights ?? NEUTRAL_LOOK.highlights, s),
    grayMix: preset.grayMix ?? null,
  };
}
