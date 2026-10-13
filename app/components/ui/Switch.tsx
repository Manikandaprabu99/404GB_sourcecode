"use client";

import { useId } from "react";

export interface TileSwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  id?: string;
  /** Accessible name, unless `labelledBy` points at visible text. */
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
}

/**
 * The bare tile switch (docs/DESIGN.md › Switch): a 46×28 track with a rounded-square knob,
 * signal when on. A real role="switch"; the hit area is 44px tall.
 */
export function TileSwitch({
  checked,
  onChange,
  disabled,
  id,
  label,
  labelledBy,
  describedBy,
  className,
}: TileSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`group relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-[9px] transition-colors duration-200 ease-out-expo after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] disabled:cursor-not-allowed ${
        checked ? "bg-signal" : "bg-surface-3"
      } ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-[3px] top-[3px] h-[22px] w-[22px] rounded-[7px] transition-[transform,background-color] duration-200 ease-spring group-active:scale-90 ${
          checked ? "translate-x-[18px] bg-signal-ink" : "translate-x-0 bg-ink-muted dark:bg-ink-faint"
        }`}
      />
    </button>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** A labeled on/off row. The whole row is clickable; the control is a real role="switch". */
export default function Switch({ checked, onChange, label, description, disabled }: SwitchProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <label
      htmlFor={id}
      className={`flex min-h-[56px] items-center justify-between gap-4 py-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="min-w-0">
        <span id={labelId} className="block text-body font-medium text-ink">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-small text-ink-muted">
            {description}
          </span>
        )}
      </span>
      <TileSwitch
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        labelledBy={labelId}
        describedBy={description ? descriptionId : undefined}
      />
    </label>
  );
}
