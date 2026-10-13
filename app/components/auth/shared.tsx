import { buttonClass } from "@/app/components/ui/Button";

// The sign-in screen's buttons, from the design system's (docs/DESIGN.md › Buttons): full
// width, and 48px tall on every screen size (the one place a big target beats density).
export const primaryAuthButtonClass = `group ${buttonClass({ variant: "primary", block: true })} sm:!min-h-[48px] sm:!px-5 sm:!text-body`;

export const secondaryAuthButtonClass = `${buttonClass({ variant: "secondary", block: true })} sm:!min-h-[48px] sm:!px-5 sm:!text-body`;

export const textAuthButtonClass = buttonClass({ variant: "ghost", size: "sm" });

export function AuthSpinner({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
