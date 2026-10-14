import type { ReactNode } from "react";

export type StatusBadgeTone = "live" | "neutral" | "attention";

/** The mark before a status: `busy` a tiny spinning ring, `done` a dot, `waiting` a hollow dot. */
export type TileGlyphState = "busy" | "done" | "waiting";

export function TileGlyph({ state, className }: { state: TileGlyphState; className?: string }) {
  if (state === "busy") {
    return (
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={`shrink-0 animate-spin [animation-duration:1.1s] ${className ?? ""}`}>
        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.8" />
        <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`h-[7px] w-[7px] shrink-0 rounded-full ${state === "done" ? "bg-current" : "shadow-[inset_0_0_0_1.5px_currentColor]"} ${className ?? ""}`}
    />
  );
}

const TONES: Record<StatusBadgeTone, string> = {
  live: "bg-accent-soft text-accent-text",
  neutral: "bg-ink/[0.06] text-ink-muted dark:bg-white/[0.08]",
  // Warning text on its tint fails AA in light, so light uses ink text.
  attention: "bg-warning/15 text-ink dark:text-warning",
};

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  /** Short and sentence case ("128 to go", "Waiting for Wi-Fi"). */
  children: ReactNode;
  glyph?: TileGlyphState | null;
  /** Read instead of the short text by screen readers (and kept in the page's text). */
  srLabel?: string;
  className?: string;
}

/** A small status pill: `live` running/OK, `neutral` waiting/paused, `attention` needs action. */
export default function StatusBadge({ tone, children, glyph, srLabel, className }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full px-2.5 text-footnote font-semibold tabular-nums transition-colors duration-180 ${TONES[tone]} ${className ?? ""}`}
    >
      {glyph && <TileGlyph state={glyph} className={tone === "attention" ? "text-warning" : undefined} />}
      <span aria-hidden={srLabel ? true : undefined} className="truncate">
        {children}
      </span>
      {srLabel && <span className="sr-only">{srLabel}</span>}
    </span>
  );
}
