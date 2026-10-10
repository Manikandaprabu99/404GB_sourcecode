import { NextRequest, NextResponse } from "next/server";
import { OAUTH_SCOPE } from "@/lib/github";
import {
  createOAuthState,
  isValidChallenge,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  oauthStateCookieOptions,
} from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

/** Starts GitHub OAuth. The Android app passes `?challenge=` (a SHA-256 of a
 * secret it keeps), which makes the callback hand the sign-in back to the app. */
export async function GET(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID is not configured" },
      { status: 500 }
    );
  }

  const challenge = req.nextUrl.searchParams.get("challenge");
  if (challenge !== null && !isValidChallenge(challenge)) {
    return NextResponse.json({ error: "invalid challenge" }, { status: 400 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const redirectUri = `${appUrl}/api/auth/github/callback`;
  const { state, sealed } = await createOAuthState(challenge ?? undefined);

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", OAUTH_SCOPE);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set(OAUTH_STATE_COOKIE, sealed, oauthStateCookieOptions(OAUTH_STATE_TTL_SECONDS));
  return res;
}
