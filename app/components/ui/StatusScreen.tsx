import type { ReactNode } from "react";
import BrandMark from "./BrandMark";

/** Full-screen centered message used by the not-found and error pages. */
export default function StatusScreen({
  eyebrow,
  title,
  message,
  children,
}: {
  eyebrow: string;
  title: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-safe-12 pt-safe-12 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-blob left-1/2 top-[18%] h-72 w-72 -translate-x-1/2 bg-accent/25" />
      </div>
      <div className="flex max-w-sm flex-col items-center gap-6 animate-fade-in-up">
        <BrandMark className="h-16 w-16 drop-shadow-[0_10px_28px_rgb(99_102_241/0.4)]" />
        <div className="flex flex-col gap-2">
          <p className="font-mono text-small font-semibold uppercase tracking-[0.2em] text-accent">
            {eyebrow}
          </p>
          <h1 className="text-h2 font-bold tracking-tight">{title}</h1>
          <p className="text-body text-ink-muted">{message}</p>
        </div>
        {children && <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
    </main>
  );
}

export const primaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full bg-ink px-5 text-small font-semibold text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95";

export const secondaryButtonClass =
  "inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border-strong px-5 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2";
