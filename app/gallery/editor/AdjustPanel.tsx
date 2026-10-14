"use client";

import { ADJUSTMENTS } from "@/lib/editor/filters";
import { hasAdjustments, type AdjustmentId, type Adjustments } from "@/lib/editor/types";
import EditorSlider from "./EditorSlider";
import { ContrastIcon, DropletIcon, ResetIcon, SunIcon, ThermometerIcon, VignetteIcon } from "./icons";

interface AdjustPanelProps {
  adjust: Adjustments;
  active: AdjustmentId;
  disabled: boolean;
  onActiveChange: (id: AdjustmentId) => void;
  onChange: (id: AdjustmentId, value: number) => void;
  onReset: () => void;
  onInteractionChange: (active: boolean) => void;
}

const ICONS = {
  brightness: SunIcon,
  contrast: ContrastIcon,
  saturation: DropletIcon,
  warmth: ThermometerIcon,
  vignette: VignetteIcon,
} satisfies Record<AdjustmentId, unknown>;

function ResetButton({ disabled, onReset }: { disabled: boolean; onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled}
      className="lv-ed-chip shrink-0 !bg-transparent"
    >
      <ResetIcon size={18} />
      Reset
    </button>
  );
}

export default function AdjustPanel({
  adjust,
  active,
  disabled,
  onActiveChange,
  onChange,
  onReset,
  onInteractionChange,
}: AdjustPanelProps) {
  const changed = hasAdjustments(adjust);
  const current = ADJUSTMENTS.find((item) => item.id === active) ?? ADJUSTMENTS[0];

  return (
    <div className="px-4">
      {/* Phones: one slider for the chosen adjustment. */}
      <div className="flex flex-col gap-1 lg:hidden">
        <EditorSlider
          label={current.label}
          value={adjust[current.id]}
          min={-100}
          max={100}
          origin={0}
          disabled={disabled}
          onChange={(value) => onChange(current.id, value)}
          onInteractionChange={onInteractionChange}
        />
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ADJUSTMENTS.map(({ id, label }) => {
            const Icon = ICONS[id];
            const selected = id === current.id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onActiveChange(id)}
                className="lv-ed-chip"
              >
                <Icon size={18} />
                {label}
                {/* Changed: a small dot (white on the selected accent chip). */}
                {adjust[id] !== 0 && (
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-current opacity-80" : "bg-accent"}`}
                  />
                )}
              </button>
            );
          })}
          <ResetButton disabled={disabled || !changed} onReset={onReset} />
        </div>
      </div>

      {/* Sidebar on large screens: every slider at once. */}
      <div className="hidden flex-col gap-2 lg:flex">
        {ADJUSTMENTS.map(({ id, label }) => {
          const Icon = ICONS[id];
          return (
            <div key={id}>
              <div className="flex items-center gap-2 text-[13px] font-medium text-white/65">
                <Icon size={16} />
                {label}
              </div>
              <EditorSlider
                label={label}
                value={adjust[id]}
                min={-100}
                max={100}
                origin={0}
                disabled={disabled}
                onChange={(value) => onChange(id, value)}
                onInteractionChange={onInteractionChange}
              />
            </div>
          );
        })}
        <div className="flex justify-end">
          <ResetButton disabled={disabled || !changed} onReset={onReset} />
        </div>
      </div>
    </div>
  );
}
