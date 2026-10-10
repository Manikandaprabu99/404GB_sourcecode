"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest("[aria-hidden='true']")
  );
}

/** Keeps Tab / Shift+Tab cycling inside `container`. Call from a keydown handler. */
export function trapTab(event: KeyboardEvent | ReactKeyboardEvent, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const items = focusableIn(container);
  if (items.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

interface EscapeLayer {
  handler: () => void;
}

const escapeStack: EscapeLayer[] = [];

function onEscapeKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || escapeStack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  escapeStack[escapeStack.length - 1].handler();
}

/** Escape closes only the most recently opened overlay that uses this hook. */
export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const layer: EscapeLayer = { handler: () => handlerRef.current() };
    if (escapeStack.length === 0) window.addEventListener("keydown", onEscapeKey, true);
    escapeStack.push(layer);
    return () => {
      const index = escapeStack.indexOf(layer);
      if (index !== -1) escapeStack.splice(index, 1);
      if (escapeStack.length === 0) window.removeEventListener("keydown", onEscapeKey, true);
    };
  }, [active]);
}

/**
 * While `active`, moves focus into the container (to `initial` if given) and
 * puts it back where it was when the overlay closes.
 */
export function useFocusReturn(
  active: boolean,
  container: RefObject<HTMLElement>,
  initial?: RefObject<HTMLElement>
) {
  const previous = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    previous.current = document.activeElement as HTMLElement | null;
    const target = initial?.current ?? container.current;
    target?.focus({ preventScroll: true });
    return () => {
      const prev = previous.current;
      previous.current = null;
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
