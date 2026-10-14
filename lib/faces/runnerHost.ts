// The Android app's side of the background People runner (docs/FACES.md "Background"): the
// app opens runner/faces.html in a WebView nobody sees, on its own origin, and talks to it
// through window.FaceRunnerHost (synchronous, JSON strings in and out). Small enough for any
// bundle; the runner itself is lib/faces/runner.ts.

export interface FaceRunnerHost {
  /** {token, login, owner, repo, branch} ("" = the default branch), or "null" when signed out. */
  getAuth(): string;
  /** {budgetPerHour, deadlineMs, localThumbnails}. */
  config(): string;
  /** {checked, total}: photos this run has checked, out of those it is working through. */
  progress(json: string): void;
  /** {checked, reason, left?, resumeAt?}, only after the last commit: the host closes the page then. */
  finished(json: string): void;
}

declare global {
  interface Window {
    FaceRunnerHost?: FaceRunnerHost;
    /** Defined by the runner before it first calls the host; the host calls it to stop the run. */
    __404gbStopRunner?: () => void;
  }
}

export const RUNNER_PATH = "/runner/faces";

/** True on the runner page, which never registers the service worker or loads the app shell. */
export function isRunnerPage(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\.html$/, "").replace(/\/+$/, "");
  return path === RUNNER_PATH || "FaceRunnerHost" in window;
}

export function isRunnerHost(value: unknown): value is FaceRunnerHost {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
  const host = value as Record<string, unknown>;
  return (
    typeof host.getAuth === "function" &&
    typeof host.config === "function" &&
    typeof host.progress === "function" &&
    typeof host.finished === "function"
  );
}
