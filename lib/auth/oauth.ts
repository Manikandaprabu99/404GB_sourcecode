import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { sealData, unsealData, type IronSession } from "iron-session";
import { sessionOptions, type SessionData } from "@/lib/session";

export const OAUTH_STATE_COOKIE = "404gb_oauth";
export const OAUTH_STATE_TTL_SECONDS = 600;
export const APP_AUTH_URL = "com.fourzerofourgb.app://auth";

// Long enough to switch from Chrome back to the app, short enough that a leaked
// ticket is useless soon after — and it never works without the app's verifier.
const MOBILE_TICKET_TTL_SECONDS = 120;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface OAuthState {
  state: string;
  challenge?: string;
}

interface MobileTicket {
  accessToken: string;
  githubLogin: string;
  challenge: string;
}

export function isValidChallenge(value: string): boolean {
  return CHALLENGE_PATTERN.test(value);
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function oauthStateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/auth/github",
    maxAge,
  };
}

export async function createOAuthState(challenge?: string) {
  const state = randomBytes(32).toString("base64url");
  const payload: OAuthState = challenge ? { state, challenge } : { state };
  const sealed = await sealData(payload, {
    password: sessionOptions.password,
    ttl: OAUTH_STATE_TTL_SECONDS,
  });
  return { state, sealed };
}

export async function readOAuthState(sealed: string | undefined): Promise<OAuthState | null> {
  if (!sealed) return null;
  try {
    // unsealData returns {} (not an error) for expired or tampered seals.
    const data = await unsealData<Partial<OAuthState>>(sealed, {
      password: sessionOptions.password,
      ttl: OAUTH_STATE_TTL_SECONDS,
    });
    if (typeof data.state !== "string") return null;
    return {
      state: data.state,
      challenge: typeof data.challenge === "string" ? data.challenge : undefined,
    };
  } catch {
    return null;
  }
}

export function createMobileTicket(ticket: MobileTicket): Promise<string> {
  return sealData(ticket, {
    password: sessionOptions.password,
    ttl: MOBILE_TICKET_TTL_SECONDS,
  });
}

export async function readMobileTicket(sealed: string): Promise<MobileTicket | null> {
  try {
    const data = await unsealData<Partial<MobileTicket>>(sealed, {
      password: sessionOptions.password,
      ttl: MOBILE_TICKET_TTL_SECONDS,
    });
    if (
      typeof data.accessToken !== "string" ||
      typeof data.githubLogin !== "string" ||
      typeof data.challenge !== "string"
    ) {
      return null;
    }
    return {
      accessToken: data.accessToken,
      githubLogin: data.githubLogin,
      challenge: data.challenge,
    };
  } catch {
    return null;
  }
}

/**
 * Signs this device in with a new token. Returns the token it replaces (for
 * revokeGitHubToken) when the device was already signed in with another one.
 */
export function establishSession(
  session: IronSession<SessionData>,
  accessToken: string,
  githubLogin: string
): string | null {
  const previous = session.accessToken && session.accessToken !== accessToken ? session.accessToken : null;
  // A different GitHub account can't use the previous account's storage repo.
  if (session.githubLogin !== githubLogin) {
    delete session.repoOwner;
    delete session.repoName;
    delete session.repoBranch;
  }
  session.accessToken = accessToken;
  session.githubLogin = githubLogin;
  return previous;
}

/**
 * Deletes one OAuth token at GitHub (best effort, never throws). GitHub keeps
 * at most 10 live tokens per user and app and silently revokes the oldest when
 * an 11th is created, which signs out some other device; deleting the tokens
 * this app no longer uses (log out, signing in again on the same device) keeps
 * every signed-in device under that limit.
 */
export async function revokeGitHubToken(accessToken: string): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret || !accessToken) return;
  try {
    await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Signed out locally either way; an orphaned token only counts toward the limit.
  }
}
