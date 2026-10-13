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

export const secondaryButtonClass = buttonClass({ variant: "secondary" });

/** What sits in the missing tile, if anything. */
function glyphFor(kind: EmptyIllustration): ReactNode {
  switch (kind) {
    case "search":
      return <SearchIcon size={14} strokeWidth={2.2} />;
    case "favorites":
      return <HeartIcon size={14} strokeWidth={2.2} />;
    case "videos":
      return <PlayIcon size={12} />;
    case "trash":
      return <TrashIcon size={14} strokeWidth={2.2} />;
    case "offline":
      return <CloudOffIcon size={14} strokeWidth={2.2} />;
    case "error":
      return <AlertIcon size={14} strokeWidth={2.2} />;
    default:
      return null;
  }
}

/**
 * The brand's 2×2 grid at 28px tiles: three solid, one dashed and breathing (docs/DESIGN.md ›
 * Empty states). The dashed tile is lime on ink and moss on paper (accent), red for errors.
 */
export function MissingTileMark({ kind = "photos", className }: { kind?: EmptyIllustration; className?: string }) {
  const tone = kind === "error" ? "border-danger text-danger" : kind === "offline" ? "border-ink-faint text-ink-muted" : "border-accent text-accent";
  return (
    <div aria-hidden="true" className={`grid grid-cols-2 gap-[5px] ${className ?? ""}`}>
      <span className="h-7 w-7 rounded-[7px] bg-surface-3" />
      <span
        className={`flex h-7 w-7 animate-breathe items-center justify-center rounded-[7px] border-[1.5px] border-dashed ${tone}`}
      >
        {glyphFor(kind)}
      </span>
      <span className="h-7 w-7 rounded-[7px] bg-surface-3" />
      <span className="h-7 w-7 rounded-[7px] bg-surface-3" />
    </div>
  );
}

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
      <MissingTileMark kind={illustration} />
      <h2 className="mt-7 font-display text-h2 text-ink">{title}</h2>
      {message && <p className="mt-2 text-small text-ink-muted">{message}</p>}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  );
}
