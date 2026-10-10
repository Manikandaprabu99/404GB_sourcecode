"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

interface EditorSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Where the fill starts; a value above `min` makes the slider two-sided and snap to it. */
  origin?: number;
  /** What a double tap resets to (defaults to `origin`). */
  resetTo?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onInteractionChange?: (active: boolean) => void;
}

const SNAP_DISTANCE = 3;
const DOUBLE_TAP_MS = 320;
const TAP_SLOP_PX = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Touch-first slider: drag anywhere on the track, snaps to the origin, double tap resets. */
export default function EditorSlider({
  label,
  value,
  min,
  max,
  origin = min,
  resetTo = origin,
  disabled,
  onChange,
  onInteractionChange,
}: EditorSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<number | null>(null);
  const pressRef = useRef<{ x: number; moved: boolean } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const percent = ((value - min) / (max - min)) * 100;
  const originPercent = ((origin - min) / (max - min)) * 100;
  const bipolar = origin > min;

  function valueAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    const raw = min + clamp((clientX - rect.left) / rect.width, 0, 1) * (max - min);
    const rounded = Math.round(raw);
    return bipolar && Math.abs(rounded - origin) <= SNAP_DISTANCE ? origin : rounded;
  }

  function stop(event: PointerEvent<HTMLDivElement>) {
    if (pointerRef.current !== event.pointerId) return;
    const press = pressRef.current;
    lastTapRef.current = press && !press.moved ? { time: performance.now(), x: press.x } : null;
    pressRef.current = null;
    pointerRef.current = null;
    setDragging(false);
    onInteractionChange?.(false);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled || pointerRef.current !== null) return;
    const tap = lastTapRef.current;
    if (tap && performance.now() - tap.time < DOUBLE_TAP_MS && Math.abs(event.clientX - tap.x) < TAP_SLOP_PX * 3) {
      lastTapRef.current = null;
      onChange(resetTo);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    pressRef.current = { x: event.clientX, moved: false };
    setDragging(true);
    onInteractionChange?.(true);
    onChange(valueAt(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pointerRef.current !== event.pointerId) return;
    const press = pressRef.current;
    if (press && Math.abs(event.clientX - press.x) > TAP_SLOP_PX) press.moved = true;
    const next = valueAt(event.clientX);
    if (next !== value) onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    const next: Record<string, number> = {
      ArrowLeft: value - step,
      ArrowDown: value - step,
      ArrowRight: value + step,
      ArrowUp: value + step,
      PageDown: value - 10,
      PageUp: value + 10,
      Home: min,
      End: max,
    };
    if (event.key in next) {
      event.preventDefault();
      event.stopPropagation();
      onChange(clamp(next[event.key], min, max));
    }
  }

  const fillLeft = Math.min(percent, originPercent);
  const fillWidth = Math.abs(percent - originPercent);
  const display = bipolar && value > origin ? `+${value}` : String(value);

  return (
    <div className={`flex items-center gap-3 ${disabled ? "opacity-40" : ""}`}>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onKeyDown={onKeyDown}
        className="group relative h-11 flex-1 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/15" />
        {bipolar && (
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/40"
            style={{ left: `${originPercent}%` }}
          />
        )}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
          style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }}
        />
        <div
          className={`absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink shadow-elevated transition-transform duration-120 ease-out-expo ${
            dragging ? "scale-110" : "group-hover:scale-105"
          }`}
          style={{ left: `${percent}%` }}
        />
        {dragging && (
          <div
            className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 rounded-md bg-surface-3 px-2 py-0.5 font-mono text-micro tabular-nums text-ink shadow-soft animate-scale-in"
            style={{ left: `${percent}%` }}
          >
            {display}
          </div>
        )}
      </div>
      <span className="w-10 shrink-0 text-right font-mono text-small tabular-nums text-ink-muted">{display}</span>
    </div>
  );
}
