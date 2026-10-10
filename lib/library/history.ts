// Sequencing helpers for overlays that live in browser history (see
// lib/ui/useHistoryOverlay): history.back() is asynchronous, so closing two
// overlays (or closing one and navigating) in the same tick would make the
// second step act on the wrong history entry.

/** Runs `fn` once the overlay that was just closed has popped its history entry. */
export function afterOverlayClosed(fn: () => void, timeoutMs = 400): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.removeEventListener("popstate", run);
    window.clearTimeout(timer);
    fn();
  };
  const timer = window.setTimeout(run, timeoutMs);
  window.addEventListener("popstate", run);
}

function topIsOverlay(): boolean {
  const state: unknown = window.history.state;
  return Boolean(state && typeof state === "object" && "__overlay" in state && state.__overlay);
}

/** Closes every open history overlay (top first), then calls `fn`. */
export function closeOverlaysThen(fn: () => void): void {
  let remaining = 8;
  const step = () => {
    if (topIsOverlay() && remaining > 0) {
      remaining -= 1;
      afterOverlayClosed(step);
      window.history.back();
    } else {
      fn();
    }
  };
  step();
}

export function hasOpenOverlay(): boolean {
  return typeof window !== "undefined" && topIsOverlay();
}
