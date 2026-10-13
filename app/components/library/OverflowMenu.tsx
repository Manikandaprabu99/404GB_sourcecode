"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { iconButtonClass, type IconButtonVariant } from "@/app/components/ui/IconButton";
import { MoreVerticalIcon } from "./icons";

export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  tone?: "danger";
  onSelect: () => void;
}

/** A "⋮" button (a header action tile by default) with a small dropdown of actions. */
export default function OverflowMenu({
  items,
  label = "More options",
  variant = "tile",
}: {
  items: OverflowMenuItem[];
  label?: string;
  variant?: IconButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${iconButtonClass({ variant })} ${open ? "!bg-surface-3 !text-ink" : ""}`}
      >
        <MoreVerticalIcon size={20} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 origin-top-right animate-scale-in rounded-lg border border-border/60 bg-surface p-1.5 shadow-elevated"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-[44px] w-full items-center gap-3 rounded-tile px-3 text-left text-body font-medium transition-colors duration-180 hover:bg-surface-2 ${
                item.tone === "danger" ? "text-danger" : "text-ink"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
