import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import { buttonClass } from "./Button";

/** "404" in display type with the 0 as the brand's missing tile, dashed and breathing. */
export function MissingTileCode({ code = "404" }: { code?: string }) {
  return (
    <p
      aria-hidden="true"
      className="flex items-center gap-[0.12em] font-display text-[5.5rem] font-bold leading-none tracking-[-0.04em] text-ink sm:text-[7rem]"
    >
      {code.split("").map((char, i) =>
        char === "0" ? (
          <span
            key={i}
            className="mx-[0.04em] block h-[0.74em] w-[0.74em] animate-breathe rounded-[0.2em] border-[0.045em] border-dashed border-accent"
          />
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </p>
  );
}

/** Full-screen centered message used by the not-found and error pages. */
export default function StatusScreen({
  eyebrow,
  title,
  message,
  art,
  children,
}: {
  eyebrow: string;
  title: string;
  message: string;
  /** Replaces the brand mark above the text (e.g. <MissingTileCode />). */
  art?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <main className="relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-safe-12 pt-safe-12 text-center">
      {/* One faint, static lime glow behind the mark (no blur filter to repaint). */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[16%] -z-10 h-80 w-80 -translate-x-1/2 bg-[radial-gradient(closest-side,rgb(var(--signal)/0.1),transparent)]"
      />
      <div className="flex max-w-sm animate-fade-in-up flex-col items-center gap-6">
        {art ?? <BrandMark missing="breathe" className="h-16 w-16" />}
        <div className="flex flex-col items-center gap-3">
          <p className="telemetry text-accent">{eyebrow}</p>
          <h1 className="font-display text-h1 text-ink">{title}</h1>
          <p className="text-body text-ink-muted">{message}</p>
        </div>
        {children && <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
    </main>
  );
}

export const primaryButtonClass = buttonClass({ variant: "primary" });

export const secondaryButtonClass = buttonClass({ variant: "secondary" });
