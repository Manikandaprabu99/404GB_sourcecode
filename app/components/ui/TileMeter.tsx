import type { ReactNode } from "react";
import { ProgressBar } from "./Progress";

interface TileMeterProps {
  /** Done so far; omit (or no `max`) for an indeterminate meter. */
  value?: number;
  max?: number;
  /** Kept for the old API (the tile count); the Lumen bar is continuous. */
  tiles?: number;
  /** Kept for the old API; the bar always fills the available width. */
  fluid?: boolean;
  /** A line above the bar, left (e.g. "Finding people"). */
  label?: ReactNode;
  /** The line's right side; defaults to "1,240 / 8,000" when `value` and `max` are known. */
  valueText?: ReactNode;
  /** False while paused: the fill turns muted. */
  active?: boolean;
  /** Accessible name when there's no plain-text `label`. */
  ariaLabel?: string;
  className?: string;
}

/** The old TileMeter API on the Lumen progress bar: a footnote line above a thin bar. */
export default function TileMeter({ value, max, label, valueText, active = true, ariaLabel, className }: TileMeterProps) {
  const known = value !== undefined && max !== undefined && max > 0;
  const shownValue =
    valueText ?? (known ? `${Math.round(value).toLocaleString()} / ${Math.round(max).toLocaleString()}` : null);

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
      {(label || shownValue) && (
        <div className="flex items-baseline justify-between gap-3 text-footnote tabular-nums text-ink-muted">
          <span className="min-w-0 truncate">{label}</span>
          {shownValue && <span className="shrink-0 font-medium text-ink">{shownValue}</span>}
        </div>
      )}
      <ProgressBar
        value={known ? value : undefined}
        max={known ? max : undefined}
        ariaLabel={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        valueText={known && typeof shownValue === "string" ? shownValue : undefined}
        paused={!active}
      />
    </div>
  );
}
