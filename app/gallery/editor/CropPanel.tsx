"use client";

import type { ReactNode } from "react";
import { ASPECT_IDS, type AspectId } from "@/lib/editor/types";
import { FlipIcon, ResetIcon, RotateLeftIcon, RotateRightIcon } from "./icons";

interface CropPanelProps {
  aspect: AspectId;
  canReset: boolean;
  disabled: boolean;
  onAspectChange: (aspect: AspectId) => void;
  onRotate: (direction: 1 | -1) => void;
  onFlip: () => void;
  onReset: () => void;
}

const ASPECT_LABELS: Record<AspectId, string> = {
  free: "Free",
  original: "Original",
  "1:1": "Square",
  "4:3": "4:3",
  "3:4": "3:4",
  "16:9": "16:9",
  "9:16": "9:16",
};

const GLYPH_RATIOS: Partial<Record<AspectId, number>> = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16 };

function AspectGlyph({ aspect }: { aspect: AspectId }) {
  if (aspect === "free") {
    return (
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="2" y="3.5" width="14" height="11" rx="1.5" strokeDasharray="2.5 2" />
      </svg>
    );
  }
  if (aspect === "original") {
    return (
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3.5" width="14" height="11" rx="1.5" />
        <path d="m4.5 12 3-3 2 2 1.5-1.5 2.5 2.5" />
      </svg>
    );
  }
  const ratio = GLYPH_RATIOS[aspect] ?? 1;
  const w = ratio >= 1 ? 14 : 14 * ratio;
  const h = ratio >= 1 ? 14 / ratio : 14;
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x={9 - w / 2} y={9 - h / 2} width={w} height={h} rx="1.5" />
    </svg>
  );
}

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[14px] text-[12px] font-medium text-white/70 transition-[background-color,color,transform] duration-150 hover:bg-white/[0.07] hover:text-white active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
      {label}
    </button>
  );
}

export default function CropPanel({
  aspect,
  canReset,
  disabled,
  onAspectChange,
  onRotate,
  onFlip,
  onReset,
}: CropPanelProps) {
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="Aspect ratio"
        className="flex items-center gap-2 overflow-x-auto px-4 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ASPECT_IDS.map((id) => {
          const selected = id === aspect;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onAspectChange(id)}
              className="lv-ed-chip"
            >
              <AspectGlyph aspect={id} />
              {ASPECT_LABELS[id]}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1 px-2">
        <ToolButton label="Rotate left" disabled={disabled} onClick={() => onRotate(-1)}>
          <RotateLeftIcon />
        </ToolButton>
        <ToolButton label="Rotate right" disabled={disabled} onClick={() => onRotate(1)}>
          <RotateRightIcon />
        </ToolButton>
        <ToolButton label="Flip" disabled={disabled} onClick={onFlip}>
          <FlipIcon />
        </ToolButton>
        <ToolButton label="Reset" disabled={disabled || !canReset} onClick={onReset}>
          <ResetIcon />
        </ToolButton>
      </div>
    </div>
  );
}
