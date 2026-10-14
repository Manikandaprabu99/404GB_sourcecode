"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEscapeLayer } from "@/app/components/ui/focus";
import { BackIcon, CheckIcon, ChevronIcon, DownloadIcon, InfoIcon, MoreIcon, ProgressRing } from "./icons";

export interface ViewerAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** For toggles (favorite): announced as pressed. */
  pressed?: boolean;
  /** Shows the label next to the icon (Trash's Restore / Delete forever). */
  labelled?: boolean;
}

export type OriginalChipState =
  | { kind: "idle" }
  | { kind: "loading"; progress: number | null }
  | { kind: "ready" }
  | { kind: "preview-only" };

/** The Original badge: "Original" with a check, "Loading original 42%", a load button, or "Preview". */
function OriginalBadge({ state, onClick }: { state: OriginalChipState; onClick: () => void }) {
  const label =
    state.kind === "ready"
      ? "Showing the original"
      : state.kind === "loading"
        ? "Loading the original"
        : state.kind === "preview-only"
          ? "Why am I seeing a preview?"
          : "Show the original";
  const percent = state.kind === "loading" && state.progress != null ? Math.round(state.progress * 100) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state.kind === "ready" || state.kind === "loading"}
      aria-label={label}
      title={label}
      className="lv-badge lv-glass pointer-events-auto disabled:cursor-default"
    >
      <span key={state.kind} className="lv-fade-in inline-flex items-center gap-1.5">
        {state.kind === "ready" && (
          <>
            <span className="lv-badge-check">
              <CheckIcon size={11} />
            </span>
            Original
          </>
        )}
        {state.kind === "loading" && (
          <>
            <ProgressRing value={state.progress} size={14} className="lv-badge-ring" />
            Loading original{percent !== null ? ` ${percent}%` : ""}
          </>
        )}
        {state.kind === "idle" && (
          <>
            <DownloadIcon size={14} />
            Show original
          </>
        )}
        {state.kind === "preview-only" && (
          <>
            <InfoIcon size={14} />
            Preview
          </>
        )}
      </span>
    </button>
  );
}

function OverflowMenu({ items }: { items: ViewerAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEscapeLayer(open, () => {
    setOpen(false);
    buttonRef.current?.focus();
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  if (items.length === 0) return null;
  return (
    <div ref={rootRef} className="relative" data-gesture-ignore>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More options"
        className="lv-round lv-glass"
      >
        <MoreIcon />
      </button>
      {open && (
        <div role="menu" aria-label="More options" className="lv-menu lv-glass">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="lv-menu-item"
            >
              <span className="flex h-5 w-5 items-center justify-center text-white/80">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar({
  visible,
  title,
  edited,
  originalChip,
  onBack,
  onOriginal,
  menu,
}: {
  visible: boolean;
  title: { date: string; time: string } | null;
  edited: boolean;
  originalChip: OriginalChipState | null;
  onBack: () => void;
  onOriginal: () => void;
  /** The overflow menu (Add to album, Download, Remove from album). */
  menu: ViewerAction[];
}) {
  return (
    <div
      className={`lv-scrim-top absolute inset-x-0 top-0 pb-10 pt-safe transition-transform duration-250 ease-out-expo ${
        visible ? "pointer-events-auto translate-y-0" : "pointer-events-none -translate-y-2"
      }`}
    >
      <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-3 px-safe-3 sm:px-safe-6">
        <button type="button" onClick={onBack} aria-label="Back" title="Back" className="lv-round lv-glass">
          <BackIcon />
        </button>
        <div className="lv-title min-w-0 flex-1 text-center">
          {title && (
            <>
              <p className="flex items-center justify-center gap-2 truncate text-[17px] font-semibold leading-[22px] tracking-[-0.01em] text-white">
                <span className="truncate">{title.date}</span>
                {edited && (
                  <span className="shrink-0 rounded-full bg-white/15 px-2 py-[2px] text-[11px] font-semibold leading-4 text-white/90">
                    Edited
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[13px] leading-[18px] tabular-nums text-white/70">{title.time}</p>
            </>
          )}
        </div>
        {menu.length > 0 ? <OverflowMenu items={menu} /> : <span className="h-11 w-11 shrink-0" aria-hidden="true" />}
      </div>
      {originalChip && (
        <div className="pointer-events-none mt-1 flex justify-center">
          <OriginalBadge state={originalChip} onClick={onOriginal} />
        </div>
      )}
    </div>
  );
}

export function BottomBar({ visible, actions }: { visible: boolean; actions: ViewerAction[] }) {
  return (
    <div
      className={`lv-scrim-bottom absolute inset-x-0 bottom-0 flex justify-center px-safe-4 pb-safe-4 pt-12 transition-transform duration-250 ease-out-expo ${
        visible ? "pointer-events-auto translate-y-0" : "pointer-events-none translate-y-3"
      }`}
    >
      <div
        role="toolbar"
        aria-label="Photo actions"
        className="lv-glass flex w-full max-w-[22rem] items-center justify-between gap-1 rounded-full p-1.5"
      >
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            aria-label={action.labelled ? undefined : action.label}
            aria-pressed={action.pressed}
            title={action.label}
            data-labelled={action.labelled ? "true" : undefined}
            className="lv-action"
          >
            {action.icon}
            {action.labelled && <span className="whitespace-nowrap">{action.label}</span>}
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
  // Glass without blur: a video can play underneath, and the blur would be redone every frame.
  const base = "lv-round lv-glass-still absolute top-1/2 -translate-y-1/2 hover:bg-white/15";
  return (
    <div className={`hidden sm:block ${visible ? "pointer-events-auto" : "pointer-events-none"}`}>
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
    <div role="status" className="pointer-events-none absolute inset-x-0 top-safe-28 flex justify-center px-4 animate-fade-in-up">
      <span className="lv-glass flex max-w-full items-center gap-2.5 rounded-full py-2 pl-3 pr-4 text-[14px] font-medium text-white">
        {progress !== undefined && <ProgressRing value={progress} size={16} className="lv-badge-ring" />}
        <span className="truncate">
          {label}
          {progress != null && <span className="tabular-nums text-white/75">{` · ${Math.round(progress * 100)}%`}</span>}
        </span>
      </span>
    </div>
  );
}
