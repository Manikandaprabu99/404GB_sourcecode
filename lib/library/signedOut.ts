// What every screen does when the API says this device is no longer signed in.
// The server already dropped the token when GitHub rejected it; this also covers
// sessions that ended some other way. Going to the sign-in page at most once per
// GUARD_MS (unless the user asked) means a stale cookie can never make the home
// page and the gallery redirect to each other in a loop.

import type { LibraryError } from "./api";

const GUARD_KEY = "404gb-left-for-sign-in";
const GUARD_MS = 20_000;
let leaving = false;

/**
 * Drops this device's token (keeping the account and repo choice) and opens the
 * sign-in page with a message. Returns false when it already did so moments ago;
 * `force` is for a deliberate tap on "Sign in".
 */
export function leaveForSignIn(options: { force?: boolean } = {}): boolean {
  if (leaving) return true;
  if (!options.force) {
    try {
      const last = Number(window.sessionStorage.getItem(GUARD_KEY));
      if (last && Date.now() - last < GUARD_MS) return false;
    } catch {
      // Without storage the in-memory flag still stops repeats on this page.
    }
  }
  try {
    window.sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // See above.
  }
  leaving = true;
  void fetch("/api/auth/logout?keep=repo", { method: "POST", credentials: "same-origin", keepalive: true })
    .catch(() => {})
    .finally(() => window.location.replace("/?error=session_expired"));
  return true;
}

/** The first auth problem among a screen's errors, as the action to take. */
export function signedOutAction(...errors: (LibraryError | null | undefined)[]): "choose-repo" | "sign-in" | null {
  const auth = errors.find((error) => error?.kind === "auth");
  if (!auth) return null;
  return auth.code === "no_repo" ? "choose-repo" : "sign-in";
}
