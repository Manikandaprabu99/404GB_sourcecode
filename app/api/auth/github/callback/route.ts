import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/?error=missing_code`);
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET; // server-only, never sent to client

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "GitHub OAuth is not configured on the server" },
      { status: 500 }
    );
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };

  if (!tokenJson.access_token) {
    return NextResponse.redirect(
      `${appUrl}/?error=${encodeURIComponent(tokenJson.error ?? "oauth_failed")}`
    );
  }

  const octokit = getOctokit(tokenJson.access_token);
  const { data: user } = await octokit.users.getAuthenticated();

  const session = await getSession();
  session.accessToken = tokenJson.access_token;
  session.githubLogin = user.login;
  await session.save();

  return NextResponse.redirect(`${appUrl}/repos`);
}
