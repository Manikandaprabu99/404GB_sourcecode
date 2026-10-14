import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CloseIcon } from "@/app/components/library/icons";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** On: accent fill. Also sets aria-checked for role="radio", else aria-pressed. */
  selected?: boolean;
  /** An icon or a small avatar before the label. */
  icon?: ReactNode;
  /** A count after the label (tabular numbers). */
  count?: number;
}

/** A 34px pill, accent fill when selected; the pseudo-element makes the hit area 44px. */
export function chipClass(selected?: boolean): string {
  return `relative inline-flex h-[34px] shrink-0 select-none items-center gap-1.5 rounded-full px-3.5 text-callout transition-[background-color,color,transform,box-shadow] duration-180 ease-out-expo after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-[''] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50 ${
    selected
      ? "bg-accent font-semibold text-accent-ink shadow-glow-signal"
      : "bg-surface-2 font-medium text-ink hover:bg-surface-3 dark:bg-ink/[0.08] dark:hover:bg-ink/[0.12]"
  }`;
}

/** A filter chip. Put it in a role="radiogroup" with role="radio" for one-of-many filters. */
const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, icon, count, className, children, type = "button", role, ...rest },
  ref
) {
  const state =
    selected === undefined ? {} : role === "radio" ? { "aria-checked": selected } : { "aria-pressed": selected };
  return (
    <button ref={ref} type={type} role={role} {...state} className={`${chipClass(selected)} ${className ?? ""}`} {...rest}>
      {icon}
      {children}
      {count !== undefined && (
        <span className={`tabular-nums ${selected ? "opacity-80" : "text-ink-muted"}`}>{count.toLocaleString()}</span>
      )}
    </button>
  );
});

export default Chip;

/** A removable search-term chip (docs/DESIGN.md › Chip: removable search chips). */
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
      className={`inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full bg-accent-soft pl-3 pr-1 text-callout font-medium text-accent-text ${className ?? ""}`}
    >
      {icon && <span className="flex">{icon}</span>}
      <span className="max-w-[12rem] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel ?? `Remove ${label}`}
        className="relative flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-180 after:absolute after:-inset-2 after:content-[''] hover:bg-accent/15"
      >
        <CloseIcon size={12} />
      </button>
    </span>
  );
}
