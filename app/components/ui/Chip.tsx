import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CloseIcon } from "@/app/components/library/icons";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** On: inverted (ink fill). Also sets aria-checked for role="radio", else aria-pressed. */
  selected?: boolean;
  icon?: ReactNode;
}

/** Class names of a filter chip (docs/DESIGN.md › Chips: 34px pill, inverted when on). The
 * pseudo-element makes the hit area 44px tall. */
export function chipClass(selected?: boolean): string {
  return `relative inline-flex h-[34px] shrink-0 select-none items-center gap-1.5 rounded-full px-3.5 text-small font-medium transition-[background-color,color,transform] duration-180 ease-out-expo after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-[''] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${
    selected ? "bg-ink text-bg" : "bg-surface-2 text-ink-muted hover:text-ink"
  }`;
}

/** A filter chip. Put it in a role="radiogroup" with role="radio" for one-of-many filters. */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, icon, className, children, type = "button", role, ...rest },
  ref
) {
  const state =
    selected === undefined ? {} : role === "radio" ? { "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button ref={ref} type={type} role={role} {...state} className={`${chipClass(selected)} ${className ?? ""}`} {...rest}>
      {icon}
      {children}
    </button>
  );
});

export default Chip;

/** A search-term chip with a remove button (docs/DESIGN.md › Chips: surface-3, ink, ×). */
export function TermChip({
  icon,
  label,
  onRemove,
  removeLabel,
  className,
}: {
  icon?: ReactNode;
  label: string;
  onRemove: () => void;
  /** Defaults to "Remove <label>". */
  removeLabel?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-surface-3 pl-3 pr-1 text-small font-medium text-ink ${className ?? ""}`}
    >
      {icon && <span className="text-ink-muted">{icon}</span>}
      <span className="max-w-[12rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel ?? `Remove ${label}`}
        className="relative flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 after:absolute after:-inset-2 after:content-[''] hover:bg-bg/40 hover:text-ink"
      >
        <CloseIcon size={12} />
      </button>
    </span>
  );
}
