import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  challengeFor,
  establishSession,
  revokeGitHubToken,
  readMobileTicket,
  safeEqual,
} from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** Called from inside the Android app after Chrome hands back a sign-in
 * ticket: proves the app holds the verifier, then signs in the app's WebView. */
export async function POST(req: NextRequest) {
  // JSON-only + same-origin: an HTML form on another site can't send either,
  // so this can't be used to silently sign a browser into someone else's account.
  const contentType = req.headers.get("content-type") ?? "";
  const origin = req.headers.get("origin");
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ error: "expected JSON" }, { status: 415 });
  }
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    ticket?: unknown;
    verifier?: unknown;
  } | null;
  const ticket = typeof body?.ticket === "string" ? body.ticket : null;
  const verifier = typeof body?.verifier === "string" ? body.verifier : null;
  if (!ticket || !verifier || !VERIFIER_PATTERN.test(verifier)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const data = await readMobileTicket(ticket);
  if (!data || !safeEqual(challengeFor(verifier), data.challenge)) {
    return NextResponse.json(
      { error: "sign-in link expired or invalid" },
      { status: 401 }
    );
  }

  const session = await getSession();
  const replaced = establishSession(session, data.accessToken, data.githubLogin);
  await session.save();
  if (replaced) await revokeGitHubToken(replaced);

  return NextResponse.json({
    ok: true,
    next: session.repoOwner && session.repoName ? "/gallery" : "/repos",
  });
}
