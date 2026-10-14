"use client";

import { useId } from "react";
import { select as hapticSelect } from "@/lib/ui/haptics";

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

/** iOS-style 51×31 switch with a white spring knob, accent when on; a haptic on change. */
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
      onClick={() => {
        hapticSelect();
        onChange(!checked);
      }}
      className={`group relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full transition-colors duration-240 ease-out-expo after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-accent" : "bg-ink/[0.16] dark:bg-white/[0.16]"
      } ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-[2px] top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.22),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-[transform,width] duration-380 ease-lumen group-active:w-[31px] ${
          checked ? "translate-x-[20px] group-active:translate-x-[16px]" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/** The same switch under its Lumen name. */
export const IOSSwitch = TileSwitch;

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
      className={`flex min-h-[52px] items-center justify-between gap-4 py-2 ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="min-w-0">
        <span id={labelId} className="block text-body font-medium text-ink">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-footnote text-ink-muted">
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
