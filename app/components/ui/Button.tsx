import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

export interface ButtonStyle {
  variant?: ButtonVariant;
  /** `md`: 48px on phones, 40px from `sm` up. `sm`: 36px with a 44px hit area (rows, notices). */
  size?: ButtonSize;
  /** `ghost` only: danger-coloured text, e.g. Sign out. */
  tone?: "danger";
  /** Full width. */
  block?: boolean;
}

const BASE =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition-[background-color,color,box-shadow,opacity,transform] duration-120 ease-out-expo active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-[48px] rounded-control px-5 text-body sm:min-h-[40px] sm:px-4 sm:text-small",
  // The pseudo-element stretches the hit area to 44px without growing the button.
  sm: "min-h-[36px] rounded-tile px-3.5 text-small after:absolute after:-inset-1 after:content-['']",
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-signal text-signal-ink hover:shadow-glow-signal",
  secondary: "bg-surface-2 text-ink hover:bg-surface-3",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  // A danger-tinted fill on ink. Danger text on a tint can't reach 4.5:1 on paper, so the
  // light theme uses the solid fill with white text instead.
  danger: "bg-danger text-danger-ink hover:bg-danger/90 dark:bg-danger/[0.12] dark:text-danger dark:hover:bg-danger/20",
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
