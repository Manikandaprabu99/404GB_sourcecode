"use client";

import type { ReactNode } from "react";
import {
  AlbumRemoveIcon,
  BackIcon,
  CheckIcon,
  ChevronIcon,
  HeartIcon,
  InfoIcon,
  OriginalIcon,
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

const ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/90 transition-[background-color,color,transform] duration-180 ease-out-expo hover:bg-white/10 hover:text-white active:scale-90 disabled:pointer-events-none disabled:opacity-40";

function OriginalChip({ state, onClick }: { state: OriginalChipState; onClick: () => void }) {
  const label =
    state.kind === "ready"
      ? "Showing the original"
      : state.kind === "loading"
        ? "Loading the original"
        : state.kind === "preview-only"
          ? "Why am I seeing a preview?"
          : "Show the original";
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
        className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-micro font-semibold tracking-wide transition-colors duration-180 ${
          state.kind === "ready"
            ? "border-white/15 bg-white/10 text-white/80"
            : "border-white/25 text-white group-hover:bg-white/10"
        }`}
      >
        {state.kind === "loading" ? (
          <ProgressRing value={state.progress} size={14} />
        ) : state.kind === "ready" ? (
          <CheckIcon size={13} />
        ) : (
          <OriginalIcon size={15} />
        )}
        {state.kind === "loading" && state.progress != null
          ? `${Math.round(state.progress * 100)}%`
          : state.kind === "preview-only"
            ? "Preview"
            : "Original"}
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
              <p className="flex items-center gap-2 truncate text-small font-semibold text-white">
                {title.date}
                {edited && (
                  <span className="rounded-full bg-white/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-white/85">
                    Edited
                  </span>
                )}
              </p>
              <p className="truncate text-micro text-white/65">{title.time}</p>
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
            className="flex min-h-[56px] min-w-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-1.5 text-white/90 transition-[background-color,color,transform] duration-180 ease-out-expo hover:bg-white/10 hover:text-white active:scale-90 disabled:pointer-events-none disabled:opacity-40"
          >
            {action.icon}
            <span className="whitespace-nowrap text-[11px] font-medium leading-none">{action.label}</span>
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
  const base =
    "absolute top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white ring-1 ring-white/15 backdrop-blur-md transition-[background-color,transform] duration-180 ease-out-expo hover:bg-black/60 active:scale-90 sm:flex";
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
      <span className="flex max-w-full items-center gap-2 rounded-full bg-black/70 px-3.5 py-2 text-small text-white shadow-elevated ring-1 ring-white/10 backdrop-blur-md">
        {progress !== undefined && <ProgressRing value={progress} size={16} />}
        <span className="truncate">
          {label}
          {progress != null ? ` · ${Math.round(progress * 100)}%` : ""}
        </span>
      </span>
    </div>
  );
}
