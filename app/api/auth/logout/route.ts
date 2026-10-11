import { NextResponse, type NextRequest } from "next/server";
import { revokeGitHubToken } from "@/lib/auth/oauth";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Signs this device out and deletes its GitHub token (frees one of GitHub's 10 per user).
 * ?keep=repo (used when a sign-in has merely ended) keeps the account and repo choice, so
 * signing in again goes straight back to the gallery, and the service worker keeps its
 * cached thumbnails (public/sw.js only purges on a full logout).
 */
export async function POST(req: NextRequest) {
  // Same-origin only: a form on another site could otherwise sign the user out (top-level
  // navigations may clear even SameSite=Lax cookies) and leave the token orphaned at GitHub.
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if ((origin && origin !== req.nextUrl.origin) || (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none")) {
    return NextResponse.json({ error: "cross-origin request" }, { status: 403 });
  }

  const keepRepo = req.nextUrl.searchParams.get("keep") === "repo";
  const session = await getSession();
  const token = session.accessToken;
  if (keepRepo) {
    if (token) {
      delete session.accessToken;
      await session.save();
    }
  } else {
    session.destroy();
  }
  if (token) await revokeGitHubToken(token);
  return NextResponse.json({ ok: true });
}
