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

/** Floating action bar for a selection, pinned above the bottom tab bar. */
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
      className="fixed inset-x-2 bottom-safe-[4.5rem] z-nav mx-auto max-w-2xl animate-fade-in-up sm:bottom-safe-6"
    >
      <div className="flex h-14 items-center gap-0.5 rounded-2xl border border-border bg-surface/95 px-1.5 shadow-elevated backdrop-blur-xl">
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel selection"
          title="Cancel"
          className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-small font-medium text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon size={18} />
          <span className="hidden sm:inline">Cancel</span>
        </button>
        <p aria-live="polite" className="shrink-0 pl-0.5 text-small font-semibold tabular-nums text-ink">
          {count}
          <span className="hidden min-[380px]:inline"> selected</span>
        </p>
        <button
          type="button"
          onClick={allSelected ? onDeselectAll : onSelectAll}
          className="shrink-0 rounded-full px-2.5 py-1.5 text-small font-medium text-accent transition-colors duration-180 hover:bg-accent/10"
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
              className={`flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-small font-medium transition-colors duration-180 active:scale-95 disabled:pointer-events-none disabled:opacity-35 ${
                action.tone === "danger" ? "text-danger hover:bg-danger/10" : "text-ink hover:bg-surface-2"
              }`}
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-180 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-35"
              >
                <MoreIcon size={18} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-full right-0 mb-2 w-56 origin-bottom-right animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated"
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
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-small font-medium transition-colors duration-180 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ${
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
