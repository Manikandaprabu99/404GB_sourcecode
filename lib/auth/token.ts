// Personal access tokens (docs/STANDALONE.md "Signing in"): the sign-in that works
// everywhere, including a desktop browser. A pasted token is checked with GET /user.

import {
  getAuthenticatedUser,
  githubRetryAfterSeconds,
  isGitHubAuthError,
  isGitHubUnreachable,
  OAUTH_SCOPE,
} from "@/lib/github";
import { rateLimitMessage } from "@/lib/library/api";

/** github.com page that pre-fills a classic token with the scope 404GB needs. */
export const NEW_TOKEN_URL = `https://github.com/settings/tokens/new?scopes=${OAUTH_SCOPE}&description=404GB`;

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/**
 * The account a token belongs to. Classic and OAuth tokens must carry the `repo` scope;
 * fine-grained tokens have no scopes and show their repo access when repos are listed.
 */
export async function checkToken(raw: string): Promise<{ token: string; login: string }> {
  const token = raw.trim();
  if (!token) throw new TokenError("Paste your token first.");
  if (/\s/.test(token) || token.length < 20) throw new TokenError("That doesn't look like a GitHub token.");
  let account: { login: string; scopes: string[] | null };
  try {
    account = await getAuthenticatedUser(token);
  } catch (err) {
    if (isGitHubAuthError(err)) throw new TokenError("GitHub didn't accept that token. Check it, or create a new one.");
    if (isGitHubUnreachable(err)) throw new TokenError("Couldn't reach GitHub. Check your connection and try again.");
    const wait = githubRetryAfterSeconds(err);
    if (wait !== null) throw new TokenError(rateLimitMessage(wait));
    throw new TokenError("Couldn't check the token with GitHub. Try again.");
  }
  if (account.scopes !== null && !account.scopes.includes(OAUTH_SCOPE)) {
    throw new TokenError("This token can't reach private repos. Create one with the “repo” scope.");
  }
  return { token, login: account.login };
}
