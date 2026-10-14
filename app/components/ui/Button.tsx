import { forwardRef, type ButtonHTMLAttributes } from "react";

/** primary: accent fill; secondary: accent-soft; tertiary: surface-2; ghost; danger. */
export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "destructive";
export type ButtonSize = "md" | "sm";

export interface ButtonStyle {
  variant?: ButtonVariant;
  /** `md`: 48px on phones, 44px from `sm` up. `sm`: 36px with a 44px hit area (rows, notices). */
  size?: ButtonSize;
  /** `ghost` only: danger-coloured text, e.g. Sign out. */
  tone?: "danger";
  /** Full width. */
  block?: boolean;
}

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,color,box-shadow,opacity,transform] duration-160 ease-out-expo active:scale-[0.97] active:opacity-90 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45";

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-[48px] px-6 text-[15px] leading-5 sm:min-h-[44px] sm:px-5",
  // The pseudo-element stretches the hit area to 44px without growing the button.
  sm: "min-h-[36px] px-4 text-callout font-semibold after:absolute after:-inset-1 after:content-['']",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong hover:shadow-glow-signal",
  secondary: "bg-accent-soft text-accent-text hover:brightness-[1.04] dark:hover:brightness-125",
  tertiary: "bg-surface-2 text-ink hover:bg-surface-3",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-danger-ink hover:bg-danger/90",
  destructive: "bg-danger text-danger-ink hover:bg-danger/90",
};

/** Class names of a button, for <button>, <Link> and <a> alike (docs/DESIGN.md › Buttons). */
export function buttonClass({ variant = "primary", size = "md", tone, block }: ButtonStyle = {}): string {
  const ghostDanger = variant === "ghost" && tone === "danger" ? "!text-danger hover:!bg-danger/10" : "";
  return `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${ghostDanger} ${block ? "w-full" : ""}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyle {}

/** A button in one of the design system's variants. `type` defaults to "button". */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, tone, block, className, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${buttonClass({ variant, size, tone, block })} ${className ?? ""}`}
      {...rest}
    />
  );
});

export default Button;
