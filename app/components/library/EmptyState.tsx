import type { ReactNode } from "react";
import { buttonClass } from "@/app/components/ui/Button";
import {
  AlertIcon,
  CloudOffIcon,
  HeartIcon,
  PlayIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";

export type EmptyIllustration = "photos" | "albums" | "search" | "favorites" | "videos" | "trash" | "offline" | "error";

export const primaryButtonClass = buttonClass({ variant: "primary" });

export const secondaryButtonClass = buttonClass({ variant: "tertiary" });

/** The glyph on the front card, if any. */
function glyphFor(kind: EmptyIllustration): ReactNode {
  switch (kind) {
    case "search":
      return <SearchIcon size={22} strokeWidth={2} />;
    case "favorites":
      return <HeartIcon size={22} strokeWidth={2} />;
    case "videos":
      return <PlayIcon size={20} />;
    case "trash":
      return <TrashIcon size={22} strokeWidth={2} />;
    case "offline":
      return <CloudOffIcon size={22} strokeWidth={2} />;
    case "error":
      return <AlertIcon size={22} strokeWidth={2} />;
    default:
      return null;
  }
}

/** Two stacked rounded photo cards over a soft accent glow (red for errors). */
export function EmptyArt({ kind = "photos", className }: { kind?: EmptyIllustration; className?: string }) {
  const glyph = glyphFor(kind);
  const tone = kind === "error" ? "text-danger" : kind === "offline" ? "text-ink-muted" : "text-accent-text";
  const glow = kind === "error" ? "rgb(var(--danger) / 0.22)" : "rgb(var(--glow) / 0.28)";
  return (
    <div aria-hidden="true" className={`relative h-28 w-36 ${className ?? ""}`}>
      <div className="absolute -inset-8" style={{ background: `radial-gradient(closest-side, ${glow}, transparent)` }} />
      <div className="absolute left-7 top-2 h-20 w-24 rotate-[10deg] rounded-[18px] bg-surface-3 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" />
      <div className="card absolute left-3 top-5 flex h-20 w-24 -rotate-[5deg] items-center justify-center overflow-hidden rounded-[18px]">
        {glyph ? (
          <span className={tone}>{glyph}</span>
        ) : (
          <svg viewBox="0 0 96 80" className="h-full w-full" aria-hidden="true">
            <circle cx="66" cy="26" r="8" className="fill-accent/70" />
            <path d="M0 80V60l26-22a4 4 0 0 1 5 0l22 20 10-8a4 4 0 0 1 5 0l28 22v8Z" className="fill-accent/45" />
          </svg>
        )}
      </div>
    </div>
  );
}

/** The old name of EmptyArt. */
export const MissingTileMark = EmptyArt;

interface EmptyStateProps {
  illustration: EmptyIllustration;
  title: string;
  message?: ReactNode;
  /** Action buttons (one primary, ideally). */
  children?: ReactNode;
}

export default function EmptyState({ illustration, title, message, children }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-sm animate-fade-in-up flex-col items-center px-6 py-14 text-center">
      <EmptyArt kind={illustration} />
      <h2 className="mt-8 text-title text-ink">{title}</h2>
      {message && <p className="mt-2 text-body text-ink-muted">{message}</p>}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  );
}
