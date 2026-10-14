import type { ReactNode } from "react";

interface ProgressCommon {
  /** Done so far; omit (or no `max`) for an indeterminate progress. */
  value?: number;
  max?: number;
  /** Accessible name. */
  ariaLabel?: string;
  /** Read instead of the numbers by screen readers ("1,240 of 8,000"). */
  valueText?: string;
  /** Muted fill (paused). */
  paused?: boolean;
  className?: string;
}

function fractionOf(value?: number, max?: number): number | null {
  if (value === undefined || max === undefined || max <= 0) return null;
  return Math.min(1, Math.max(0, value / max));
}

/** A thin rounded bar (docs/DESIGN.md › Progress: 6px, accent on surface-3). */
export function ProgressBar({ value, max, ariaLabel, valueText, paused, className, height = 6 }: ProgressCommon & { height?: number }) {
  const fraction = fractionOf(value, max);
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={fraction !== null ? 0 : undefined}
      aria-valuemax={fraction !== null ? max : undefined}
      aria-valuenow={fraction !== null ? value : undefined}
      aria-valuetext={fraction !== null ? valueText : undefined}
      className={`relative w-full overflow-hidden rounded-full bg-surface-3 dark:bg-ink/[0.1] ${className ?? ""}`}
      style={{ height }}
    >
      {fraction !== null ? (
        <span
          className={`absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-380 ease-lumen ${
            paused ? "bg-ink-faint" : "bg-accent"
          }`}
          style={{ transform: `scaleX(${Math.max(fraction, fraction > 0 ? 0.02 : 0)})` }}
        />
      ) : (
        <span className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-full bg-accent" />
      )}
    </div>
  );
}

/** The ring variant (People, backup): a circle that fills clockwise, optional content inside. */
export function ProgressRing({
  value,
  max,
  ariaLabel,
  valueText,
  paused,
  className,
  size = 44,
  stroke = 4,
  children,
}: ProgressCommon & { size?: number; stroke?: number; children?: ReactNode }) {
  const fraction = fractionOf(value, max);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={fraction !== null ? 0 : undefined}
      aria-valuemax={fraction !== null ? max : undefined}
      aria-valuenow={fraction !== null ? value : undefined}
      aria-valuetext={fraction !== null ? valueText : undefined}
      className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        aria-hidden="true"
        className={`absolute inset-0 -rotate-90 ${fraction === null ? "animate-spin [animation-duration:1.4s]" : ""}`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-surface-3 dark:text-ink/[0.12]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          className={`transition-[stroke-dashoffset] duration-380 ease-lumen ${paused ? "text-ink-faint" : "text-accent"}`}
          strokeDasharray={c}
          strokeDashoffset={fraction === null ? c * 0.72 : c * (1 - fraction)}
        />
      </svg>
      {children && <span className="relative flex items-center justify-center">{children}</span>}
    </span>
  );
}
