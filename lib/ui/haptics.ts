// Light haptics via navigator.vibrate (Android app); a no-op elsewhere or with reduced motion.

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Blocked (no user gesture yet, or not allowed): feedback is optional.
  }
}

/** One step: a drag-select change, a scrubber month, a snap. */
export function tick(): void {
  vibrate(8);
}

/** A long press that starts selection, a toggle. */
export function select(): void {
  vibrate(12);
}

/** Something finished well: saved, backed up, merged. */
export function confirm(): void {
  vibrate([10, 40, 18]);
}
