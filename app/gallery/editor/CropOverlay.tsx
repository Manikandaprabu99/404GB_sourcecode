"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dragCrop, type CropHandle } from "@/lib/editor/geometry";
import type { CropRect, Size } from "@/lib/editor/types";

interface CropOverlayProps {
  crop: CropRect;
  /** Displayed size (CSS px) of the whole picture the overlay sits on. */
  size: Size;
  /** Locked width / height, or null for a free crop. */
  ratio: number | null;
  disabled?: boolean;
  onChange: (crop: CropRect) => void;
  onInteractionChange: (active: boolean) => void;
}

const MIN_CROP_PX = 56;
const HIT = 44;
const CORNERS: CropHandle[] = ["nw", "ne", "se", "sw"];
const EDGES: CropHandle[] = ["n", "e", "s", "w"];
const CURSORS: Record<CropHandle, string> = {
  move: "move",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/** Touch targets centered on the crop's border; edges span their whole length between the corners. */
function hitAreaStyle(handle: CropHandle): CSSProperties {
  const half = -HIT / 2;
  const style: CSSProperties = { cursor: CURSORS[handle] };
  if (handle.includes("n")) style.top = half;
  if (handle.includes("s")) style.bottom = half;
  if (handle.includes("w")) style.left = half;
  if (handle.includes("e")) style.right = half;
  if (handle === "n" || handle === "s") {
    style.left = HIT / 2;
    style.right = HIT / 2;
    style.height = HIT;
  } else if (handle === "e" || handle === "w") {
    style.top = HIT / 2;
    style.bottom = HIT / 2;
    style.width = HIT;
  } else {
    style.width = HIT;
    style.height = HIT;
  }
  return style;
}

/** The visible L of a corner handle, drawn at the corner of its hit area. */
function CornerMark({ handle }: { handle: CropHandle }) {
  const horizontal: CSSProperties = { height: 3, width: 20 };
  const vertical: CSSProperties = { width: 3, height: 20 };
  const anchor: CSSProperties = {};
  if (handle.includes("n")) anchor.top = HIT / 2 - 2;
  if (handle.includes("s")) anchor.bottom = HIT / 2 - 2;
  if (handle.includes("w")) anchor.left = HIT / 2 - 2;
  if (handle.includes("e")) anchor.right = HIT / 2 - 2;
  return (
    <>
      <span className="absolute rounded-[1.5px] bg-white shadow-soft" style={{ ...anchor, ...horizontal }} />
      <span className="absolute rounded-[1.5px] bg-white shadow-soft" style={{ ...anchor, ...vertical }} />
    </>
  );
}

export default function CropOverlay({ crop, size, ratio, disabled, onChange, onInteractionChange }: CropOverlayProps) {
  const dragRef = useRef<{ handle: CropHandle; x: number; y: number; start: CropRect; pointerId: number } | null>(null);
  const [active, setActive] = useState<CropHandle | null>(null);

  const begin = (handle: CropHandle) => (event: PointerEvent<HTMLElement>) => {
    if (disabled || dragRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { handle, x: event.clientX, y: event.clientY, start: crop, pointerId: event.pointerId };
    setActive(handle);
    onInteractionChange(true);
  };

  function move(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    onChange(dragCrop(drag.start, drag.handle, event.clientX - drag.x, event.clientY - drag.y, size, ratio, MIN_CROP_PX));
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setActive(null);
    onInteractionChange(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 20 : 4;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[event.key];
    if (!d || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(dragCrop(crop, "move", d[0], d[1], size, ratio, MIN_CROP_PX));
  }

  const box: CSSProperties = {
    left: crop.x * size.width,
    top: crop.y * size.height,
    width: crop.w * size.width,
    height: crop.h * size.height,
  };

  return (
    <div className="absolute inset-0 animate-fade-in" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute transition-[box-shadow] duration-180"
          style={{ ...box, boxShadow: `0 0 0 9999px rgb(0 0 0 / ${active ? 0.45 : 0.62})` }}
        />
      </div>
      <div
        role="group"
        aria-label="Crop area. Drag to move, use the corners to resize, or the arrow keys to nudge."
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onPointerDown={begin("move")}
        className="absolute touch-none outline-none ring-1 ring-white/90 focus-visible:ring-2 focus-visible:ring-accent"
        style={{ ...box, cursor: "move" }}
      >
        <div
          className={`pointer-events-none absolute inset-0 transition-opacity duration-180 ${
            active ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="absolute inset-y-0 left-1/3 w-px bg-white/45" />
          <div className="absolute inset-y-0 left-2/3 w-px bg-white/45" />
          <div className="absolute inset-x-0 top-1/3 h-px bg-white/45" />
          <div className="absolute inset-x-0 top-2/3 h-px bg-white/45" />
        </div>
        {EDGES.map((handle) => (
          <div
            key={handle}
            aria-hidden="true"
            className="absolute flex touch-none items-center justify-center"
            style={hitAreaStyle(handle)}
            onPointerDown={begin(handle)}
          >
            <span
              className={`rounded-[1.5px] bg-white/90 shadow-soft ${
                handle === "n" || handle === "s" ? "h-[3px] w-6" : "h-6 w-[3px]"
              }`}
            />
          </div>
        ))}
        {CORNERS.map((handle) => (
          <div
            key={handle}
            aria-hidden="true"
            className="absolute touch-none"
            style={hitAreaStyle(handle)}
            onPointerDown={begin(handle)}
          >
            <CornerMark handle={handle} />
          </div>
        ))}
      </div>
    </div>
  );
}
