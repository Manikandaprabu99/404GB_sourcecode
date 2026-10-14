"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { select as hapticSelect } from "@/lib/ui/haptics";

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

/** A radio group as a surface-2 track with a sliding raised thumb; arrow keys move it. */
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

  function choose(next: T) {
    hapticSelect();
    onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    buttons.current[next]?.focus();
    choose(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={onKeyDown}
      className={`relative grid rounded-[12px] bg-surface-2 p-[3px] dark:bg-ink/[0.07] ${disabled ? "opacity-60" : ""} ${className ?? ""}`}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[3px] left-[3px] top-[3px] rounded-[9px] bg-surface shadow-[0_1px_2px_rgb(15_20_30/0.08),0_3px_8px_rgb(15_20_30/0.08)] transition-transform duration-380 ease-lumen dark:bg-surface-3 dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]"
          style={{ width: `calc((100% - 6px) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
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
            onClick={() => !on && choose(option.value)}
            className={`relative flex min-h-[34px] min-w-0 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-callout transition-colors duration-180 after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] disabled:cursor-not-allowed ${
              on ? "font-semibold text-ink" : "font-medium text-ink-muted hover:text-ink"
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
