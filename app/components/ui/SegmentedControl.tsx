"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Accessible name when `label` isn't plain text (e.g. a preview). */
  ariaLabel?: string;
}

interface SegmentedControlProps<T> {
  /** Accessible name of the group. */
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * One-of-a-few choice (docs/DESIGN.md › Segmented control): a surface-2 track with a
 * sliding segment, as a radio group (arrow keys move the choice). Segments share the width.
 */
export default function SegmentedControl<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options.some((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    buttons.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={`relative grid rounded-control bg-surface-2 p-1 ${disabled ? "opacity-60" : ""} ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-tile bg-surface shadow-soft transition-transform duration-250 ease-out-expo dark:bg-surface-3 dark:shadow-none"
          style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
        />
      )}
      {options.map((option, i) => {
        const on = selected && i === index;
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={option.ariaLabel}
            tabIndex={on || (!selected && i === 0) ? 0 : -1}
            disabled={disabled}
            onClick={() => !on && onChange(option.value)}
            className={`relative flex min-h-[36px] min-w-0 items-center justify-center gap-1.5 rounded-tile px-2.5 text-small font-medium transition-colors duration-180 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] disabled:cursor-not-allowed ${
              on ? "text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
