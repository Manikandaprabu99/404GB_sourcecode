"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CloseIcon, MoreIcon } from "./icons";

export interface SelectionAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "danger";
  disabled?: boolean;
  /** Listed under "More" instead of on the bar. */
  overflow?: boolean;
}

interface SelectionBarProps {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  actions: SelectionAction[];
}

// docs/DESIGN.md › Selection bar: surface-3 on ink, inverted (ink) on paper. These are the
// paper colours, with dark: overrides back to the surface scale.
const BAR = "bg-ink text-bg dark:border dark:border-border/60 dark:bg-surface-3 dark:text-ink";
const HOVER = "hover:bg-bg/10 dark:hover:bg-ink/10";
const BUTTON = `relative flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-md text-small font-medium transition-[background-color,color,opacity,transform] duration-120 ease-out-expo active:scale-[0.94] disabled:pointer-events-none disabled:opacity-35 ${HOVER}`;

/** Floating action bar for a selection, pinned above the floating tab bar. */
export default function SelectionBar({
  count,
  allSelected,
  onSelectAll,
  onDeselectAll,
  onCancel,
  actions,
}: SelectionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const primary = actions.filter((action) => !action.overflow);
  const secondary = actions.filter((action) => action.overflow);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      role="toolbar"
      aria-label="Selected items"
      className="fixed bottom-safe-[5.25rem] left-safe-3 right-safe-3 z-nav mx-auto max-w-2xl animate-fade-in-up sm:bottom-safe-6"
    >
      <div className={`flex h-14 items-center gap-0.5 rounded-card px-1.5 shadow-elevated ${BAR}`}>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel selection"
          title="Cancel"
          className={`${BUTTON} w-11 sm:w-auto sm:px-3`}
        >
          <CloseIcon size={18} />
          <span className="hidden sm:inline">Cancel</span>
        </button>
        <p aria-live="polite" className="telemetry shrink-0 pl-1 pr-1">
          {count}
          <span className="hidden min-[380px]:inline"> selected</span>
        </p>
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className={`${BUTTON} px-2.5 font-semibold text-accent-inverse dark:text-accent`}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>

        <div className="ml-auto flex items-center">
          {primary.map((action) => (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled || count === 0}
              aria-label={action.label}
              title={action.label}
              // On the inverted (ink) bar of the paper theme, the ink theme's danger reads.
              className={`${BUTTON} min-w-[44px] px-2.5 ${action.tone === "danger" ? "text-[rgb(255_90_110)] dark:text-danger" : ""}`}
            >
              {action.icon}
              <span className="hidden md:inline">{action.label}</span>
            </button>
          ))}

          {secondary.length > 0 && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                disabled={count === 0}
                aria-label="More actions"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`${BUTTON} w-11`}
              >
                <MoreIcon size={18} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 mb-2 w-56 origin-bottom-right animate-scale-in rounded-lg border border-border/60 bg-surface p-1.5 text-ink shadow-elevated"
                >
                  {secondary.map((action) => (
                    <button
                      key={action.key}
                      type="button"
                      role="menuitem"
                      disabled={action.disabled}
                      onClick={() => {
                        setMenuOpen(false);
                        action.onClick();
                      }}
                      className={`flex min-h-[44px] w-full items-center gap-3 rounded-tile px-3 text-left text-body font-medium transition-colors duration-180 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ${
                        action.tone === "danger" ? "text-danger" : "text-ink"
                      }`}
                    >
                      {action.icon}
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
