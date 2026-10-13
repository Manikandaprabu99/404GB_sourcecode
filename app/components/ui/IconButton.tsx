import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type IconButtonVariant = "tile" | "ghost" | "signal";

export interface IconButtonStyle {
  /** `tile`: surface-2 square (page header actions). `ghost`: no fill until hovered. `signal`: lime. */
  variant?: IconButtonVariant;
  /** Visual size in px; the hit area is never under 44px. */
  size?: 36 | 40 | 44;
}

const SIZES = {
  36: "h-9 w-9 rounded-tile after:-inset-1",
  40: "h-10 w-10 rounded-md after:-inset-0.5",
  44: "h-11 w-11 rounded-md after:inset-0",
} as const;

const VARIANTS: Record<IconButtonVariant, string> = {
  tile: "bg-surface-2 text-ink hover:bg-surface-3",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
  signal: "bg-signal text-signal-ink hover:shadow-glow-signal",
};

/** Class names of a square icon button, for <button> and <Link> alike. */
export function iconButtonClass({ variant = "tile", size = 40 }: IconButtonStyle = {}): string {
  return `relative inline-flex shrink-0 select-none items-center justify-center transition-[background-color,color,box-shadow,opacity,transform] duration-120 ease-out-expo after:absolute after:content-[''] active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]}`;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">, IconButtonStyle {
  /** The accessible name (also the tooltip unless `title` is given). */
  label: string;
  children: ReactNode;
}

/** A square icon-only button (docs/DESIGN.md › Page header: 40px, surface-2, radius 12). */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, title, variant, size, className, type = "button", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={`${iconButtonClass({ variant, size })} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
