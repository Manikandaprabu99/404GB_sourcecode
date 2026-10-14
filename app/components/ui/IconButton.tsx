import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export type IconButtonVariant = "tile" | "glass" | "ghost" | "signal" | "accent";

export interface IconButtonStyle {
  /** `tile`/`glass`: translucent round header button (no blur); `ghost`; `signal`/`accent`. */
  variant?: IconButtonVariant;
  /** Visual size in px; the hit area is never under 44px. */
  size?: 36 | 40 | 44;
}

const SIZES = {
  36: "h-9 w-9 after:-inset-1",
  40: "h-10 w-10 after:-inset-0.5",
  44: "h-11 w-11 after:inset-0",
} as const;

const GLASS =
  "bg-ink/[0.06] text-ink shadow-[inset_0_0_0_1px_rgb(var(--hairline))] hover:bg-ink/10 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]";

const VARIANTS: Record<IconButtonVariant, string> = {
  tile: GLASS,
  glass: GLASS,
  ghost: "text-ink-muted hover:bg-ink/[0.06] hover:text-ink",
  signal: "bg-accent text-accent-ink hover:bg-accent-strong",
  accent: "bg-accent text-accent-ink hover:bg-accent-strong",
};

/** Class names of a round icon button, for <button> and <Link> alike. */
export function iconButtonClass({ variant = "tile", size = 40 }: IconButtonStyle = {}): string {
  return `relative inline-flex shrink-0 select-none items-center justify-center rounded-full transition-[background-color,color,box-shadow,opacity,transform] duration-160 ease-out-expo after:absolute after:rounded-full after:content-[''] active:scale-[0.92] disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]}`;
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">, IconButtonStyle {
  /** The accessible name (also the tooltip unless `title` is given). */
  label: string;
  children: ReactNode;
}

/** A round icon-only button (docs/DESIGN.md › Page header: 40px glass icon buttons). */
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
