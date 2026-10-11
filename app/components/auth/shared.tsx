export const primaryAuthButtonClass =
  "group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-ink px-6 text-body font-semibold text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-glow-accent active:translate-y-0 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60";

export const secondaryAuthButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-border-strong px-6 text-body font-medium text-ink transition-colors duration-180 hover:bg-surface-2 active:scale-[0.98]";

export const textAuthButtonClass =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-small font-medium text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink";

export function AuthSpinner({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
