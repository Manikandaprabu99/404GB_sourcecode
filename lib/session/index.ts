import { getIronSession, IronSession, SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  accessToken?: string;
  githubLogin?: string;
  repoOwner?: string;
  repoName?: string;
  /** Cached default branch for repoOwner/repoName, so the Section 11 sync
   * check (GET /api/media?sinceSha=) doesn't need an extra repos.get() call
   * on every gallery load just to find the branch name for the refs API. */
  repoBranch?: string;
  /** Epoch ms of the last rolling renewal (see renewSessionIfStale). */
  renewedAt?: number;
}

export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const secret = process.env.SESSION_SECRET;

export const sessionOptions: SessionOptions = {
  // Falls back to a dev-only placeholder so `next build` can statically
  // analyze routes without real secrets set. Never used with real data
  // unless SESSION_SECRET is actually configured (routes are dynamic).
  password: secret && secret.length >= 32 ? secret : "0".repeat(32),
  cookieName: "404gb_session",
  // Cookie maxAge derives from ttl, and each save() re-seals with a fresh expiry (rolling renewal).
  ttl: SESSION_TTL_SECONDS,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/** Stamps renewedAt when missing or over a day old; true means save() to send the fresh cookie. */
export function renewSessionIfStale(session: SessionData, now = Date.now()): boolean {
  const last = session.renewedAt;
  if (typeof last === "number" && now - last < RENEW_INTERVAL_MS && last <= now + CLOCK_SKEW_MS) {
    return false;
  }
  session.renewedAt = now;
  return true;
}
