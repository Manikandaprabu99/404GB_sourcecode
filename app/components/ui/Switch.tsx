"use client";

import { useId } from "react";

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
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descriptionId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`group relative inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full border transition-colors duration-250 ease-out-expo disabled:cursor-not-allowed ${
          checked ? "border-accent bg-accent" : "border-border-strong bg-surface-3"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-[3px] top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)] transition-transform duration-250 ease-spring group-active:scale-90 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
