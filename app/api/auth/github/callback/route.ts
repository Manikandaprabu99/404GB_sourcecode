import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getOctokit } from "@/lib/github";
import {
  APP_AUTH_URL,
  createMobileTicket,
  establishSession,
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  readOAuthState,
  safeEqual,
} from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Shown in Chrome at the end of an app sign-in. Auto-opens the app; the button
// covers browsers that block opening an app without a tap.
function appHandoffPage(target: string): NextResponse {
  const scriptTarget = JSON.stringify(target).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Returning to 404GB</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#060609;color:#fafafb;font-family:system-ui,-apple-system,sans-serif;text-align:center}
main{padding:24px;max-width:22rem}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#a3a3ac;margin:0 0 1.5rem;line-height:1.5}
a{display:inline-block;padding:.85rem 1.5rem;border-radius:999px;background:#fafafb;color:#060609;font-weight:600;text-decoration:none}
</style>
</head>
<body>
<main>
<h1>Returning to 404GB</h1>
<p>If the app doesn't open by itself, tap the button.</p>
<a href="${escapeHtml(target)}">Open 404GB</a>
</main>
<script>location.replace(${scriptTarget});</script>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const params = req.nextUrl.searchParams;

  const finish = (res: NextResponse) => {
    res.cookies.set(OAUTH_STATE_COOKIE, "", oauthStateCookieOptions(0));
    return res;
  };

  const saved = await readOAuthState(req.cookies.get(OAUTH_STATE_COOKIE)?.value);
  const returnedState = params.get("state");
  if (!saved || !returnedState || !safeEqual(saved.state, returnedState)) {
    return finish(NextResponse.redirect(`${appUrl}/?error=oauth_state`));
  }

  const isAppSignIn = Boolean(saved.challenge);
  const fail = (reason: string) =>
    finish(
      isAppSignIn
        ? appHandoffPage(`${APP_AUTH_URL}?error=${encodeURIComponent(reason)}`)
        : NextResponse.redirect(`${appUrl}/?error=${encodeURIComponent(reason)}`)
    );

  const code = params.get("code");
  if (!code) {
    return fail(params.get("error") ?? "missing_code");
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
    return fail(tokenJson.error ?? "oauth_failed");
  }

  const octokit = getOctokit(tokenJson.access_token);
  const { data: user } = await octokit.users.getAuthenticated();

  if (saved.challenge) {
    // Don't sign in this browser: the app redeems the ticket in its own WebView.
    const ticket = await createMobileTicket({
      accessToken: tokenJson.access_token,
      githubLogin: user.login,
      challenge: saved.challenge,
    });
    return finish(appHandoffPage(`${APP_AUTH_URL}?ticket=${encodeURIComponent(ticket)}`));
  }

  const session = await getSession();
  establishSession(session, tokenJson.access_token, user.login);
  await session.save();

  return finish(NextResponse.redirect(`${appUrl}/repos`));
}
