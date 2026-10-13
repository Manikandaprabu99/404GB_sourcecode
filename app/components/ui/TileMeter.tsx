import type { ReactNode } from "react";

interface TileMeterProps {
  /** Done so far; omit (or no `max`) for an indeterminate meter. */
  value?: number;
  max?: number;
  /** Number of tiles (default 12). */
  tiles?: number;
  /** Tiles share the available width instead of being 16px each. */
  fluid?: boolean;
  /** Telemetry line above the tiles, left (e.g. "Finding people"). */
  label?: ReactNode;
  /** Telemetry line, right; defaults to "1,240 / 8,000" when `value` and `max` are known. */
  valueText?: ReactNode;
  /** Pulse the tile being filled (default true): set false while paused. */
  active?: boolean;
  /** Accessible name when there's no plain-text `label`. */
  ariaLabel?: string;
  className?: string;
}

/**
 * Progress as a row of tiles filling with the signal colour (docs/DESIGN.md › Tile meter):
 * 16×8 tiles, radius 3, 3px apart; the one being filled pulses gently.
 */
export default function TileMeter({
  value,
  max,
  tiles = 12,
  fluid,
  label,
  valueText,
  active = true,
  ariaLabel,
  className,
}: TileMeterProps) {
  const known = value !== undefined && max !== undefined && max > 0;
  const fraction = known ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = fraction * tiles;
  const full = Math.floor(filled);
  const partial = filled - full;
  const shownValue =
    valueText ?? (known ? `${Math.round(value).toLocaleString()} / ${Math.round(max).toLocaleString()}` : null);

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className ?? ""}`}>
      {(label || shownValue) && (
        <div className="telemetry flex items-baseline justify-between gap-3 text-ink-muted">
          <span className="min-w-0 truncate">{label}</span>
          {shownValue && <span className="shrink-0 text-ink">{shownValue}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
        aria-valuemin={known ? 0 : undefined}
        aria-valuemax={known ? max : undefined}
        aria-valuenow={known ? value : undefined}
        aria-valuetext={known && typeof shownValue === "string" ? shownValue : undefined}
        className="flex gap-[3px]"
      >
        {Array.from({ length: tiles }, (_, i) => {
          const isFull = i < full;
          const isCurrent = !isFull && i === full && (known ? fraction < 1 : i === 0);
          return (
            <span
              key={i}
              className={`relative h-2 overflow-hidden rounded-[3px] bg-surface-3 ${fluid ? "min-w-[6px] flex-1" : "w-4 shrink-0"}`}
            >
              {(isFull || isCurrent) && (
                <span
                  className={`absolute inset-0 origin-left rounded-[3px] bg-signal transition-transform duration-320 ease-out-expo ${
                    isCurrent && active ? "animate-tile-pulse" : ""
                  }`}
                  style={isFull ? undefined : { transform: `scaleX(${known ? Math.max(0.12, partial) : 1})` }}
                />
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
