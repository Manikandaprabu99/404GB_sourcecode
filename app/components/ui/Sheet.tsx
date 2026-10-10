"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { trapTab, useEscapeLayer, useFocusReturn } from "./focus";

export interface SheetProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children: ReactNode;
}

const EXIT_MS = 220;
const DRAG_CLOSE_PX = 110;

/**
 * Bottom sheet on phones (drag the handle down to dismiss), centered dialog
 * on larger screens. Back, Escape and the backdrop all close it.
 */
export default function Sheet({ open, onClose, title, children }: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [canPortal, setCanPortal] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const drag = useRef<{ startY: number; dy: number; lastY: number; lastT: number; v: number } | null>(null);

  useEffect(() => setCanPortal(true), []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const panel = panelRef.current;
      if (panel) {
        panel.style.transform = "";
        panel.style.transition = "";
      }
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  const active = open && mounted && canPortal;
  useHistoryOverlay(open, onClose);
  useEscapeLayer(open, onClose);
  useFocusReturn(active, panelRef);

  function onHandleDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" || (e.target as HTMLElement).closest("button")) return;
    if (window.matchMedia("(min-width: 640px)").matches) return; // centered dialog, not a sheet
    drag.current = { startY: e.clientY, dy: 0, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.v = 0.7 * ((e.clientY - d.lastY) / dt) + 0.3 * d.v;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    const raw = e.clientY - d.startY;
    // Resist dragging up past the resting position.
    d.dy = raw > 0 ? raw : raw / 4;
    panel.style.transition = "none";
    panel.style.transform = `translateY(${d.dy}px)`;
  }

  function onHandleUp() {
    const d = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!d || !panel) return;
    if (d.dy > DRAG_CLOSE_PX || (d.v > 0.5 && d.dy > 20)) {
      onClose();
      return;
    }
    panel.style.transition = "transform 260ms cubic-bezier(0.16,1,0.3,1)";
    panel.style.transform = "";
  }

  if (!mounted || !canPortal) return null;

  return createPortal(
    <div className="fixed inset-0 z-sheet flex items-end justify-center sm:items-center sm:p-6">
      <div
        aria-hidden="true"
        className={`absolute inset-0 bg-black/50 ${open ? "animate-fade-in" : "animate-fade-out"}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={(e) => panelRef.current && trapTab(e, panelRef.current)}
        className={`relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface text-ink shadow-sheet outline-none sm:max-h-[80vh] sm:max-w-md sm:rounded-2xl sm:border sm:shadow-elevated ${
          open ? "animate-sheet-in sm:animate-scale-in" : "animate-sheet-out sm:animate-scale-out"
        }`}
      >
        <div
          className="shrink-0 touch-none select-none px-5 pt-2.5 sm:pt-4"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
          <div className="flex min-h-[44px] items-center justify-between gap-3 pt-1.5 sm:pt-0">
            {title ? (
              <h2 id={titleId} className="min-w-0 truncate text-h3 font-semibold">
                {title}
              </h2>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-safe-6 pt-2 sm:pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
