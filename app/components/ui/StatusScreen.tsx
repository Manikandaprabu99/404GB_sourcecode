import type { ReactNode } from "react";
import BrandMark from "./BrandMark";
import { buttonClass } from "./Button";

/** A large "404" in the sans with the 0 drawn as two stacked photo cards. */
export function MissingTileCode({ code = "404" }: { code?: string }) {
  return (
    <p aria-hidden="true" className="flex items-center gap-[0.06em] text-[5.5rem] font-bold leading-none tracking-[-0.05em] text-ink sm:text-[7rem]">
      {code.split("").map((char, i) =>
        char === "0" ? (
          <span key={i} className="relative mx-[0.06em] block h-[0.72em] w-[0.62em]">
            <span className="absolute inset-0 rotate-[8deg] rounded-[0.14em] bg-accent/30" />
            <span className="absolute inset-0 -rotate-[4deg] rounded-[0.14em] bg-accent shadow-glow-signal" />
          </span>
        ) : (
          <span key={i}>{char}</span>
        )
      )}
    </p>
  );
}

/** Full-screen centred message used by the not-found and error pages. */
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
    <main className="aurora relative isolate flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pb-safe-12 pt-safe-12 text-center">
      <div className="flex max-w-sm animate-fade-in-up flex-col items-center gap-7">
        {art ?? <BrandMark className="h-16 w-16 drop-shadow-[0_12px_28px_rgb(22_96_235/0.4)]" />}
        <div className="flex flex-col items-center gap-2">
          <p className="text-footnote font-semibold text-accent-text">{eyebrow}</p>
          <h1 className="text-large-title text-ink">{title}</h1>
          <p className="text-body text-ink-muted">{message}</p>
        </div>
        {children && <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>}
      </div>
    </main>
  );
}

export const primaryButtonClass = buttonClass({ variant: "primary" });

export const secondaryButtonClass = buttonClass({ variant: "tertiary" });
