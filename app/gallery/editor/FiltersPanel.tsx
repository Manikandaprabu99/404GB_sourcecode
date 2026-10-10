"use client";

import { useEffect, useRef } from "react";
import { applyColorProgram, buildColorProgram } from "@/lib/editor/color";
import { FILTER_PRESETS, resolveLook } from "@/lib/editor/filters";
import { cropKey, renderSquareBase, type PreviewSource } from "@/lib/editor/preview";
import type { EditState, FilterId } from "@/lib/editor/types";
import EditorSlider from "./EditorSlider";

interface FiltersPanelProps {
  source: PreviewSource | null;
  state: EditState;
  disabled: boolean;
  onSelect: (id: FilterId) => void;
  onStrengthChange: (value: number) => void;
  onInteractionChange: (active: boolean) => void;
}

const THUMB_CSS_PX = 64;

export default function FiltersPanel({
  source,
  state,
  disabled,
  onSelect,
  onStrengthChange,
  onInteractionChange,
}: FiltersPanelProps) {
  const canvases = useRef(new Map<FilterId, HTMLCanvasElement>());
  const baseRef = useRef<{ key: string; data: ImageData } | null>(null);
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  const geometryKey = source ? [source.id, state.rotation, state.flipH ? 1 : 0, cropKey(state.crop)].join("|") : "";
  const adjustKey = JSON.stringify(state.adjust);

  // Live previews of every preset on this photo (with its current crop and adjustments).
  useEffect(() => {
    if (!source) return;
    const frame = requestAnimationFrame(() => {
      try {
        const size = Math.round(THUMB_CSS_PX * Math.min(2, window.devicePixelRatio || 1));
        const key = `${geometryKey}|${size}`;
        if (baseRef.current?.key !== key) baseRef.current = { key, data: renderSquareBase(source, state, size) };
        const base = baseRef.current.data;
        const out = new ImageData(size, size);
        const vignette = { cx: size / 2, cy: size / 2, rx: size / 2, ry: size / 2 };
        for (const preset of FILTER_PRESETS) {
          const canvas = canvases.current.get(preset.id);
          if (!canvas) continue;
          const program = buildColorProgram(resolveLook(preset.id, 100, state.adjust));
          applyColorProgram(program, base.data, out.data, size, size, vignette);
          if (canvas.width !== size || canvas.height !== size) {
            canvas.width = size;
            canvas.height = size;
          }
          canvas.getContext("2d")?.putImageData(out, 0, 0);
        }
      } catch (err) {
        console.warn("[404gb] filter previews failed", err);
      }
    });
    return () => cancelAnimationFrame(frame);
    // geometryKey and adjustKey capture everything the previews read from `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, geometryKey, adjustKey]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);

  const filtered = state.filter !== "original";

  return (
    <div className="flex flex-col gap-1">
      <div
        className={`px-4 transition-opacity duration-180 ease-out-expo ${filtered ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-hidden={!filtered}
      >
        <EditorSlider
          label="Filter intensity"
          value={state.filterStrength}
          min={0}
          max={100}
          resetTo={100}
          disabled={disabled || !filtered}
          onChange={onStrengthChange}
          onInteractionChange={onInteractionChange}
        />
      </div>
      <div
        role="radiogroup"
        aria-label="Filters"
        className="flex gap-3 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {FILTER_PRESETS.map((preset) => {
          const selected = state.filter === preset.id;
          return (
            <button
              key={preset.id}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onSelect(preset.id)}
              className="group flex shrink-0 flex-col items-center gap-1.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50"
            >
              <span
                className={`block h-16 w-16 overflow-hidden rounded-xl bg-surface-3 ring-2 ring-offset-2 ring-offset-bg transition-[box-shadow,transform] duration-180 ease-out-expo ${
                  selected ? "scale-100 ring-accent" : "scale-95 ring-transparent group-hover:ring-ink/25"
                }`}
              >
                <canvas
                  ref={(node) => {
                    if (node) canvases.current.set(preset.id, node);
                    else canvases.current.delete(preset.id);
                  }}
                  className="h-full w-full animate-fade-in"
                />
              </span>
              <span className={`text-micro ${selected ? "font-semibold text-ink" : "text-ink-muted"}`}>
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
