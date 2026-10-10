"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aspectRatio } from "@/lib/editor/geometry";
import {
  cropKey,
  PreviewRenderer,
  previewRegionSize,
  type PreviewRegion,
  type PreviewSource,
} from "@/lib/editor/preview";
import type { CropRect, EditState, Size } from "@/lib/editor/types";
import CropOverlay from "./CropOverlay";

export interface StageAnimation {
  kind: "rotate-cw" | "rotate-ccw" | "flip";
  nonce: number;
}

interface EditorStageProps {
  source: PreviewSource | null;
  state: EditState;
  /** Shows the whole picture with the crop box instead of the cropped result. */
  cropping: boolean;
  /** Shows the picture without color edits (press-and-hold compare). */
  compare: boolean;
  /** A slider or handle is being dragged: slow devices may render a draft. */
  interacting: boolean;
  disabled: boolean;
  animation: StageAnimation | null;
  onCropChange: (crop: CropRect) => void;
  onInteractionChange: (active: boolean) => void;
  children?: ReactNode;
}

interface Layout {
  region: PreviewRegion;
  /** CSS pixels on screen. */
  display: Size;
  /** Canvas pixels: screen resolution, but never more than the source has. */
  pixels: Size;
  left: number;
  top: number;
}

const MAX_PREVIEW_PIXELS = 4_500_000;
const DRAFT_AFTER_MS = 24;
const TURN_ANIMATION: KeyframeAnimationOptions = { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" };

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export default function EditorStage({
  source,
  state,
  cropping,
  compare,
  interacting,
  disabled,
  animation,
  onCropChange,
  onInteractionChange,
  children,
}: EditorStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const paintedKeyRef = useRef("");
  const animatedNonceRef = useRef(animation?.nonce ?? 0);
  const lastDisplayRef = useRef<Size | null>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    },
    []
  );

  const region: PreviewRegion = cropping ? "full" : "crop";
  const padding = cropping ? 28 : 12;
  const regionSize = source ? previewRegionSize(source, state, region) : null;
  const regionWidth = regionSize?.width ?? 0;
  const regionHeight = regionSize?.height ?? 0;

  const layout = useMemo<Layout | null>(() => {
    if (!regionWidth || !regionHeight || stage.width <= 0 || stage.height <= 0) return null;
    const fit = Math.min(
      Math.max(1, stage.width - padding * 2) / regionWidth,
      Math.max(1, stage.height - padding * 2) / regionHeight
    );
    const display = { width: regionWidth * fit, height: regionHeight * fit };
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(fit * dpr, 1, Math.sqrt(MAX_PREVIEW_PIXELS / (regionWidth * regionHeight)));
    return {
      region,
      display,
      pixels: {
        width: Math.max(1, Math.round(regionWidth * scale)),
        height: Math.max(1, Math.round(regionHeight * scale)),
      },
      left: (stage.width - display.width) / 2,
      top: (stage.height - display.height) / 2,
    };
  }, [regionWidth, regionHeight, stage.width, stage.height, padding, region]);

  const draft = interacting && (rendererRef.current?.lastRenderMs ?? 0) > DRAFT_AFTER_MS;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!source || !layout || !canvas) return;
    const renderer = (rendererRef.current ??= new PreviewRenderer());
    const size = draft
      ? { width: Math.max(1, Math.round(layout.pixels.width / 2)), height: Math.max(1, Math.round(layout.pixels.height / 2)) }
      : layout.pixels;
    const paint = () => {
      try {
        renderer.render(canvas, source, state, { region: layout.region, size, color: !compare, draft });
      } catch (err) {
        console.warn("[404gb] preview render failed", err);
      }
    };
    const geometryKey = [
      source.id,
      layout.region,
      layout.pixels.width,
      layout.pixels.height,
      state.rotation,
      state.flipH ? 1 : 0,
      layout.region === "crop" ? cropKey(state.crop) : "",
    ].join("|");
    if (geometryKey !== paintedKeyRef.current) {
      // Geometry changed: paint before this frame is shown, so a resized canvas never flashes stretched.
      paintedKeyRef.current = geometryKey;
      paint();
      return;
    }
    const frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [source, layout, state, compare, draft]);

  useLayoutEffect(() => {
    const previous = lastDisplayRef.current;
    lastDisplayRef.current = layout?.display ?? null;
    if (!animation || animation.nonce === animatedNonceRef.current) return;
    animatedNonceRef.current = animation.nonce;
    const box = boxRef.current;
    if (!box || !previous || !layout || typeof box.animate !== "function" || prefersReducedMotion()) return;
    // Start from the old pose (the new picture turned back and scaled to the old size), then settle.
    const from =
      animation.kind === "flip"
        ? "scaleX(-1)"
        : `rotate(${animation.kind === "rotate-cw" ? -90 : 90}deg) scale(${previous.width / layout.display.height})`;
    box.animate([{ transform: from }, { transform: "none" }], TURN_ANIMATION);
  }, [animation, layout]);

  return (
    <div ref={stageRef} className="relative min-h-0 flex-1 touch-none select-none overflow-hidden bg-black">
      {source && layout && (
        <div
          ref={boxRef}
          className="absolute"
          style={{ left: layout.left, top: layout.top, width: layout.display.width, height: layout.display.height }}
        >
          <canvas ref={canvasRef} className="block h-full w-full" />
          {cropping && (
            <CropOverlay
              crop={state.crop}
              size={layout.display}
              ratio={aspectRatio(state.aspect, layout.display)}
              disabled={disabled}
              onChange={onCropChange}
              onInteractionChange={onInteractionChange}
            />
          )}
        </div>
      )}
      {children}
    </div>
  );
}
