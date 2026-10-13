"use client";

import type { ReactNode } from "react";
import { TileGlyph } from "@/app/components/ui/StatusBadge";
import {
  AlbumRemoveIcon,
  BackIcon,
  CheckIcon,
  ChevronIcon,
  DownloadIcon,
  HeartIcon,
  InfoIcon,
  ProgressRing,
} from "./icons";

export interface ViewerAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}

export type OriginalChipState =
  | { kind: "idle" }
  | { kind: "loading"; progress: number | null }
  | { kind: "ready" }
  | { kind: "preview-only" };

// docs/DESIGN.md › Viewer / editor chrome: dark gradient bars, round 44px icon buttons.
const ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition-[background-color,color,transform] duration-180 ease-out-expo hover:bg-white/10 hover:text-white active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40";

/**
 * Whether the photo on screen is the original, as a label badge (24px, radius 8, telemetry
 * text): ORIGINAL ✓ in signal once it shows; neutral with the percentage while it loads; an
 * outlined button to load it (very large photos); PREVIEW for formats a browser can't draw.
 */
function OriginalChip({ state, onClick }: { state: OriginalChipState; onClick: () => void }) {
  const label =
    state.kind === "ready"
      ? "Showing the original"
      : state.kind === "loading"
        ? "Loading the original"
        : state.kind === "preview-only"
          ? "Why am I seeing a preview?"
          : "Show the original";
  const tone =
    state.kind === "ready"
      ? "bg-signal text-signal-ink"
      : state.kind === "loading"
        ? "bg-white/15 text-white/85"
        : "text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.32)] group-hover:bg-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.kind === "ready" || state.kind === "loading"}
      aria-label={label}
      title={label}
      className="group flex h-11 shrink-0 items-center px-1 disabled:cursor-default"
    >
      <span
        key={state.kind}
        className={`telemetry flex h-6 animate-fade-in items-center gap-1.5 rounded-tile-sm px-2 transition-colors duration-180 ${tone}`}
      >
        {state.kind === "loading" && <TileGlyph state="busy" />}
        {state.kind === "preview-only" ? "Preview" : "Original"}
        {state.kind === "ready" && <CheckIcon size={12} />}
        {state.kind === "idle" && <DownloadIcon size={13} />}
        {state.kind === "loading" && state.progress != null && (
          <span className="tabular-nums">{Math.round(state.progress * 100)}%</span>
        )}
      </span>
    </button>
  );
}

export function TopBar({
  visible,
  title,
  edited,
  favorite,
  favoritePulse,
  originalChip,
  onBack,
  onFavorite,
  onInfo,
  onOriginal,
  onRemoveFromAlbum,
}: {
  visible: boolean;
  title: { date: string; time: string } | null;
  edited: boolean;
  favorite: boolean;
  /** Changes each time the item is favorited, replaying the heart animation. */
  favoritePulse: number;
  originalChip: OriginalChipState | null;
  onBack: () => void;
  /** Left out where favorites don't apply (Trash). */
  onFavorite?: () => void;
  onInfo: () => void;
  onOriginal: () => void;
  onRemoveFromAlbum?: () => void;
}) {
  return (
    <div
      className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 via-black/35 to-transparent pb-8 pt-safe transition-transform duration-250 ease-out-expo ${
        visible ? "pointer-events-auto translate-y-0" : "pointer-events-none -translate-y-3"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-safe-1 sm:px-safe-3">
        <button type="button" onClick={onBack} aria-label="Back" title="Back" className={ICON_BUTTON}>
          <BackIcon />
        </button>
        <div className="min-w-0 flex-1 px-1">
          {title && (
            <>
              <p className="flex items-center gap-2 truncate text-body font-semibold leading-tight text-white">
                {title.date}
                {edited && (
                  <span className="telemetry rounded-[5px] bg-white/15 px-1.5 py-[3px] text-[10px] text-white/85">Edited</span>
                )}
              </p>
              <p className="telemetry mt-1 truncate text-white/70">{title.time}</p>
            </>
          )}
        </div>
        {originalChip && <OriginalChip state={originalChip} onClick={onOriginal} />}
        {onFavorite && (
          <button
            type="button"
            onClick={onFavorite}
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={favorite}
            title={favorite ? "Remove from favorites" : "Favorite"}
            className={ICON_BUTTON}
          >
            <span key={favoritePulse} className={favoritePulse > 0 && favorite ? "animate-pop" : undefined}>
              <HeartIcon filled={favorite} className={favorite ? "text-favorite" : undefined} />
            </span>
          </button>
        )}
        <button type="button" onClick={onInfo} aria-label="Details" title="Details" className={ICON_BUTTON}>
          <InfoIcon />
        </button>
        {onRemoveFromAlbum && (
          <button
            type="button"
            onClick={onRemoveFromAlbum}
            aria-label="Remove from album"
            title="Remove from album"
            className={ICON_BUTTON}
          >
            <AlbumRemoveIcon />
          </button>
        )}
      </div>
    </div>
  );
}

export function BottomBar({ visible, actions }: { visible: boolean; actions: ViewerAction[] }) {
  return (
    <div
      className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/35 to-transparent pb-safe-1 pt-10 transition-transform duration-250 ease-out-expo ${
        visible ? "pointer-events-auto translate-y-0" : "pointer-events-none translate-y-3"
      }`}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-safe-1">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.label}
            className="group flex min-h-[60px] min-w-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1 text-white/90 transition-[color,transform] duration-180 ease-out-expo hover:text-white active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40"
          >
            {/* The icon sits in a round 44px spot that lights up on hover. */}
            <span className="flex h-9 w-11 items-center justify-center rounded-full transition-colors duration-180 group-hover:bg-white/10">
              {action.icon}
            </span>
            <span className="whitespace-nowrap text-micro font-medium leading-none">{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SideArrows({
  visible,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  visible: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  // No blur: a video can play underneath, and the blur would be redone every frame.
  const base =
    "absolute top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white ring-1 ring-white/15 transition-[background-color,transform] duration-180 ease-out-expo hover:bg-black/70 active:scale-[0.94] sm:flex";
  return (
    <div className={visible ? "pointer-events-auto" : "pointer-events-none"}>
      {hasPrev && (
        <button type="button" onClick={onPrev} aria-label="Previous" title="Previous" className={`${base} left-safe-4`}>
          <ChevronIcon direction="left" />
        </button>
      )}
      {hasNext && (
        <button type="button" onClick={onNext} aria-label="Next" title="Next" className={`${base} right-safe-4`}>
          <ChevronIcon direction="right" />
        </button>
      )}
    </div>
  );
}

/** Small floating status ("Saving to your phone · 45%"), visible even with the toolbars hidden. */
export function StatusPill({ label, progress }: { label: string; progress?: number | null }) {
  return (
    <div
      role="status"
      className="pointer-events-none absolute inset-x-0 top-safe-16 flex justify-center px-4 animate-fade-in-up"
    >
      <span className="flex max-w-full items-center gap-2.5 rounded-control bg-black/75 py-2 pl-3 pr-3.5 text-small text-white shadow-elevated ring-1 ring-white/10">
        {progress !== undefined && <ProgressRing value={progress} size={16} className="text-signal" />}
        <span className="truncate">
          {label}
          {progress != null && <span className="font-mono tabular-nums text-white/75">{` · ${Math.round(progress * 100)}%`}</span>}
        </span>
      </span>
    </div>
  );
}
