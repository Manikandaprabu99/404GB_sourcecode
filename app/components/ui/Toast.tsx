"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export type ToastTone = "default" | "success" | "error";

export interface ToastOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Auto-dismiss delay. 0 keeps the toast until it's dismissed or updated. */
  durationMs?: number;
  tone?: ToastTone;
}

export interface ToastHandle {
  id: number;
  /** Changes the toast in place (e.g. "Saving…" → "Saved") and restarts its timer. */
  update: (options: Partial<ToastOptions>) => void;
  dismiss: () => void;
}

export type ShowToast = (options: ToastOptions) => ToastHandle;

const NOOP_HANDLE: ToastHandle = { id: 0, update: () => {}, dismiss: () => {} };
const ToastContext = createContext<ShowToast>(() => NOOP_HANDLE);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

interface ToastItem extends ToastOptions {
  id: number;
  leaving: boolean;
}

interface Timer {
  handle: number | null;
  remaining: number;
  startedAt: number;
}

const MAX_VISIBLE = 3;
const EXIT_MS = 180;
const SWIPE_DISMISS_PX = 80;

function durationFor(options: ToastOptions): number {
  return options.durationMs ?? (options.actionLabel ? 6000 : 4000);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastsRef = useRef<ToastItem[]>([]);
  toastsRef.current = toasts;
  const nextId = useRef(1);
  const timers = useRef(new Map<number, Timer>());
  const paused = useRef(false);
  // Toasts being hovered or focused ("hover:<id>", "focus:<id>"); any of them pauses every timer.
  // Kept per toast because one removed from under the pointer never sends pointerleave.
  const holds = useRef(new Set<string>());
  const releaseRef = useRef<(id: number) => void>(() => {});

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer?.handle != null) window.clearTimeout(timer.handle);
    timers.current.delete(id);
    releaseRef.current(id);
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, EXIT_MS);
  }, []);

  const schedule = useCallback(
    (id: number, ms: number) => {
      const existing = timers.current.get(id);
      if (existing?.handle != null) window.clearTimeout(existing.handle);
      if (!ms) {
        timers.current.delete(id);
        return;
      }
      const timer: Timer = { handle: null, remaining: ms, startedAt: Date.now() };
      if (!paused.current) timer.handle = window.setTimeout(() => dismiss(id), ms);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const update = useCallback(
    (id: number, patch: Partial<ToastOptions>) => {
      const current = toastsRef.current.find((t) => t.id === id);
      if (!current || current.leaving) return;
      const merged = { ...current, ...patch };
      setToasts((list) => list.map((t) => (t.id === id ? { ...merged, leaving: false } : t)));
      schedule(id, durationFor(merged));
    },
    [schedule]
  );

  const show = useCallback<ShowToast>(
    (options) => {
      const id = nextId.current++;
      const active = toastsRef.current.filter((t) => !t.leaving);
      active.slice(0, Math.max(0, active.length - (MAX_VISIBLE - 1))).forEach((t) => dismiss(t.id));
      const item: ToastItem = { ...options, id, leaving: false };
      toastsRef.current = [...toastsRef.current, item];
      setToasts((list) => [...list, item]);
      schedule(id, durationFor(options));
      return { id, update: (patch) => update(id, patch), dismiss: () => dismiss(id) };
    },
    [dismiss, schedule, update]
  );

  // Hovering or focusing a toast pauses every timer, so actions like Undo stay reachable.
  const pause = useCallback(() => {
    if (paused.current) return;
    paused.current = true;
    const now = Date.now();
    timers.current.forEach((timer) => {
      if (timer.handle == null) return;
      window.clearTimeout(timer.handle);
      timer.handle = null;
      timer.remaining = Math.max(1000, timer.remaining - (now - timer.startedAt));
    });
  }, []);

  const resume = useCallback(() => {
    if (!paused.current) return;
    paused.current = false;
    timers.current.forEach((timer, id) => {
      timer.startedAt = Date.now();
      timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
    });
  }, [dismiss]);

  const hold = useCallback(
    (key: string, on: boolean) => {
      if (on) holds.current.add(key);
      else holds.current.delete(key);
      if (holds.current.size > 0) pause();
      else resume();
    },
    [pause, resume]
  );
  releaseRef.current = (id: number) => {
    if (!holds.current.has(`hover:${id}`) && !holds.current.has(`focus:${id}`)) return;
    holds.current.delete(`hover:${id}`);
    holds.current.delete(`focus:${id}`);
    if (holds.current.size === 0) resume();
  };

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions text"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-toast flex flex-col items-center gap-2 px-4 pb-safe-[5.5rem] sm:pb-safe-6"
      >
        {toasts.map((toast) => (
          <ToastView
            key={toast.id}
            toast={toast}
            onDismiss={() => dismiss(toast.id)}
            onHold={(kind, on) => hold(`${kind}:${toast.id}`, on)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// A round tone mark before the message.
function ToneIcon({ tone }: { tone: ToastTone }) {
  if (tone === "success") {
    return (
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="m6.5 12.5 3.6 3.6 7.4-8" />
        </svg>
      </span>
    );
  }
  if (tone === "error") {
    return (
      <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          <path d="M12 6.5v7M12 17.5v.1" />
        </svg>
      </span>
    );
  }
  return null;
}

function ToastView({
  toast,
  onDismiss,
  onHold,
}: {
  toast: ToastItem;
  onDismiss: () => void;
  /** Hovered (mouse) or focused, or no longer: pauses or resumes the timers. */
  onHold: (kind: "hover" | "focus", on: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; dx: number; captured: boolean } | null>(null);
  const tone = toast.tone ?? "default";
  const hasAction = Boolean(toast.actionLabel && toast.onAction);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" || toast.leaving) return;
    drag.current = { x: e.clientX, dx: 0, captured: false };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    d.dx = e.clientX - d.x;
    // Capture only once it's clearly a swipe, so taps still reach the action button.
    if (!d.captured && Math.abs(d.dx) > 8) {
      d.captured = true;
      el.setPointerCapture(e.pointerId);
    }
    if (!d.captured) return;
    el.style.transition = "none";
    el.style.transform = `translateX(${d.dx}px)`;
    el.style.opacity = String(Math.max(0, 1 - Math.abs(d.dx) / 220));
  }

  function onPointerEnd() {
    const d = drag.current;
    const el = ref.current;
    drag.current = null;
    if (!d || !el || !d.captured) return;
    if (Math.abs(d.dx) > SWIPE_DISMISS_PX) {
      onDismiss();
      return;
    }
    el.style.transition = "transform 220ms cubic-bezier(0.16,1,0.3,1), opacity 220ms";
    el.style.transform = "";
    el.style.opacity = "";
  }

  return (
    <div
      ref={ref}
      role={tone === "error" ? "alert" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      // A toast on its way out can't hold the others (it would never send the matching leave).
      onPointerEnter={(e) => e.pointerType === "mouse" && !toast.leaving && onHold("hover", true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && onHold("hover", false)}
      onFocus={() => !toast.leaving && onHold("focus", true)}
      onBlur={() => onHold("focus", false)}
      className={`glass hairline pointer-events-auto flex min-h-[48px] w-fit min-w-[min(16rem,100%)] max-w-md touch-pan-y select-none items-center gap-2.5 rounded-[24px] py-2 text-callout text-ink shadow-[0_12px_32px_-12px_rgb(0_0_0/0.5)] ${
        hasAction ? "pr-1.5" : "pr-5"
      } ${tone === "default" ? "pl-5" : "pl-2.5"} ${toast.leaving ? "animate-toast-out" : "animate-toast-in"}`}
    >
      <ToneIcon tone={tone} />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {hasAction && (
        <button
          type="button"
          className="-my-1 min-h-[40px] shrink-0 rounded-full px-3.5 text-callout font-semibold text-accent-text transition-colors duration-180 hover:bg-accent-soft"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
    </div>
  );
}
