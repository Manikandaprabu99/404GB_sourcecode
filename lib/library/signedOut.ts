// What every screen does when the library says this device is no longer signed in. A GitHub
// 401 already ended the session (lib/session), and the app shell then shows the sign-in
// screen; this covers screens that notice first. Ending a sign-in is final for that token
// and the sign-in screen never sends a token-less session anywhere, so the sign-in screen
// and the gallery can't bounce the user between each other.

import { dropToken } from "@/lib/session";
import type { LibraryError } from "./api";

/** Drops this device's token, keeping the account and repo choice; the app shell then shows sign-in. */
export function leaveForSignIn(): void {
  dropToken();
}

/** The first auth problem among a screen's errors, as the action to take. */
export function signedOutAction(...errors: (LibraryError | null | undefined)[]): "choose-repo" | "sign-in" | null {
  const auth = errors.find((error) => error?.kind === "auth");
  if (!auth) return null;
  return auth.code === "no_repo" ? "choose-repo" : "sign-in";
}
