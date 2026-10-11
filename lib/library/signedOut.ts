// What every screen does when the API says this device is no longer signed in.
// The server already cleared the session cookie when GitHub rejected the token;
// logging out here covers sessions that simply expired. Going to the sign-in
// page at most once per GUARD_MS means a stale cookie can never make the home
// page and the gallery redirect to each other in a loop.

import type { LibraryError } from "./api";

const GUARD_KEY = "404gb-left-for-sign-in";
const GUARD_MS = 20_000;
let leaving = false;

/** Signs out and opens the sign-in page with a message. False when it already did so moments ago. */
export function leaveForSignIn(reason: "session_expired" = "session_expired"): boolean {
  if (leaving) return true;
  try {
    const last = Number(window.sessionStorage.getItem(GUARD_KEY));
    if (last && Date.now() - last < GUARD_MS) return false;
    window.sessionStorage.setItem(GUARD_KEY, String(Date.now()));
  } catch {
    // Without storage the in-memory flag still stops repeats on this page.
  }
  leaving = true;
  void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", keepalive: true })
    .catch(() => {})
    .finally(() => window.location.replace(`/?error=${reason}`));
  return true;
}

/** The first auth problem among a screen's errors, as the action to take. */
export function signedOutAction(...errors: (LibraryError | null | undefined)[]): "choose-repo" | "sign-in" | null {
  const auth = errors.find((error) => error?.kind === "auth");
  if (!auth) return null;
  return auth.code === "no_repo" ? "choose-repo" : "sign-in";
}
