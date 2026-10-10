"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useHistoryOverlay } from "@/lib/ui/useHistoryOverlay";
import { trapTab, useEscapeLayer } from "./focus";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  id: number;
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  async () => false
);

const EXIT_MS = 200;

/** In-app replacement for window.confirm: `if (await confirm({...})) ...` */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [closing, setClosing] = useState(false);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;
  const closingRef = useRef(false);
  const nextId = useRef(1);
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const settle = useCallback((confirmed: boolean) => {
    const current = pendingRef.current;
    if (!current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    current.resolve(confirmed);
    window.setTimeout(() => {
      closingRef.current = false;
      setClosing(false);
      setPending((p) => (p === current ? null : p));
    }, EXIT_MS);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A newer request replaces an unanswered one, which counts as "cancel".
        pendingRef.current?.resolve(false);
        closingRef.current = false;
        setClosing(false);
        setPending({ ...options, id: nextId.current++, resolve });
      }),
    []
  );

  const open = pending !== null && !closing;
  useHistoryOverlay(open, () => settle(false));
  useEscapeLayer(open, () => settle(false));

  // Focus the least destructive choice; put focus back where it was afterwards.
  const pendingId = pending?.id;
  const destructive = Boolean(pending?.destructive);
  useEffect(() => {
    if (pendingId === undefined) return;
    const previous = document.activeElement as HTMLElement | null;
    (destructive ? cancelRef : confirmRef).current?.focus({ preventScroll: true });
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [pendingId, destructive]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className={`fixed inset-0 z-dialog flex items-end justify-center bg-black/55 sm:items-center sm:p-4 ${
            closing ? "animate-fade-out" : "animate-fade-in"
          }`}
          onClick={() => settle(false)}
        >
          <div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            aria-describedby={pending.message ? "confirm-message" : undefined}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => panelRef.current && trapTab(e, panelRef.current)}
            className={`w-full rounded-t-2xl border-t border-border bg-surface px-5 pb-safe-5 pt-3 shadow-sheet sm:max-w-sm sm:rounded-2xl sm:border sm:p-6 sm:shadow-elevated ${
              closing ? "animate-sheet-out sm:animate-scale-out" : "animate-sheet-in sm:animate-scale-in"
            }`}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden="true" />
            <div className="flex items-start gap-4">
              {pending.destructive && (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
                  </svg>
                </span>
              )}
              <div className="min-w-0 pt-1.5">
                <h2 id="confirm-title" className="text-h3 font-semibold text-ink">
                  {pending.title}
                </h2>
                {pending.message && (
                  <p id="confirm-message" className="mt-1.5 text-body text-ink-muted">
                    {pending.message}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-6 flex gap-3 sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => settle(false)}
                className="h-12 flex-1 rounded-full bg-surface-2 px-5 text-body font-medium text-ink transition-colors duration-180 hover:bg-surface-3 active:scale-[0.98] sm:h-10 sm:flex-none sm:bg-transparent sm:text-small sm:hover:bg-surface-2"
              >
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                type="button"
                onClick={() => settle(true)}
                className={`h-12 flex-1 rounded-full px-5 text-body font-semibold transition-all duration-180 ease-out-expo active:scale-[0.98] sm:h-10 sm:flex-none sm:text-small ${
                  pending.destructive
                    ? "bg-danger text-danger-ink hover:bg-danger/90"
                    : "bg-ink text-bg hover:bg-ink/90"
                }`}
              >
                {pending.confirmLabel ?? "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
