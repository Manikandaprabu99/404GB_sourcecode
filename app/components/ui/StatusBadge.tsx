import type { ReactNode } from "react";

export type StatusBadgeTone = "live" | "neutral" | "attention";

/**
 * The 2×2 glyph in front of a status: `busy` fills its tiles in turn (uploading), `done` is
 * the complete grid, `waiting` keeps the brand's missing (outlined) tile.
 */
export type TileGlyphState = "busy" | "done" | "waiting";

// Grid order (TL, TR, BL, BR), lit clockwise 400ms apart; negative delays start every tile
// mid-cycle so the first frame already looks like the loop.
const STEP_DELAYS = ["0ms", "-1200ms", "-400ms", "-800ms"];

export function TileGlyph({ state, className }: { state: TileGlyphState; className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 grid-cols-2 gap-[1.5px] ${className ?? ""}`}>
      {STEP_DELAYS.map((delay, i) => {
        const missing = state === "waiting" && i === 1;
        return (
          <span
            key={i}
            className={`h-[5px] w-[5px] rounded-[1px] ${
              missing ? "shadow-[inset_0_0_0_1px_currentColor]" : "bg-current"
            } ${state === "busy" ? "animate-tile-step" : ""}`}
            style={state === "busy" ? { animationDelay: delay } : undefined}
          />
        );
      })}
    </span>
  );
}

const TONES: Record<StatusBadgeTone, string> = {
  live: "bg-signal text-signal-ink",
  neutral: "bg-surface-3 text-ink-muted",
  // Warning text on its own tint is under 4.5:1 on paper, so the light theme keeps the
  // tint and the glyph in warning and sets the text in ink.
  attention: "bg-warning/15 text-ink dark:text-warning",
};

export interface StatusBadgeProps {
  tone: StatusBadgeTone;
  /** Shown uppercase in the telemetry face; keep it short ("128 to go", "Waiting · Wi-Fi"). */
  children: ReactNode;
  glyph?: TileGlyphState | null;
  /** Read instead of the short text by screen readers (and kept in the page's text). */
  srLabel?: string;
  className?: string;
}

/**
 * Status badge (docs/DESIGN.md › Status badge): 24px, radius 8, telemetry text. `live` for
 * running/OK states, `neutral` for waiting/paused, `attention` when the user has to act.
 */
export default function StatusBadge({ tone, children, glyph, srLabel, className }: StatusBadgeProps) {
  return (
    <span
      className={`telemetry inline-flex h-6 max-w-full items-center gap-1.5 rounded-tile-sm px-2 transition-colors duration-180 ${TONES[tone]} ${className ?? ""}`}
    >
      {glyph && <TileGlyph state={glyph} className={tone === "attention" ? "text-warning" : undefined} />}
      <span aria-hidden={srLabel ? true : undefined} className="truncate">
        {children}
      </span>
      {srLabel && <span className="sr-only normal-case">{srLabel}</span>}
    </span>
  );
}
