import { NextResponse, type NextRequest } from "next/server";
import type { IronSession } from "iron-session";
import {
  CorruptJsonError,
  getDefaultBranch,
  githubMessage,
  githubRetryAfterSeconds,
  githubStatus,
  isGitHubAuthError,
  isGitHubUnreachable,
  TransactionConflictError,
  TreeWriteError,
  type RepoRef,
} from "@/lib/github";
import { getSession, renewSessionIfStale, type SessionData } from "./index";

/** An error with a deliberate HTTP status and a message safe to show users. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function json(status: number, body: Record<string, unknown>, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

/**
 * Any thrown error as the API's JSON error; GitHub rate limits become 429 + Retry-After.
 * When GitHub rejects the token (revoked, or GitHub's 10-tokens-per-user limit pushed it
 * out) the session is destroyed too, so the next page load shows sign-in instead of
 * bouncing between the home page and the gallery.
 */
export function errorResponse(err: unknown, session?: IronSession<SessionData> | null): NextResponse {
  if (err instanceof ApiError) {
    return json(err.status, { error: err.message, ...(err.code ? { code: err.code } : {}), ...err.details });
  }
  const githubError = err instanceof TreeWriteError ? err.githubError : err;

  const retryAfter = githubRetryAfterSeconds(githubError);
  if (retryAfter !== null) {
    return json(
      429,
      { error: "GitHub rate limit reached — try again later", code: "rate_limited", retryAfter },
      { "Retry-After": String(retryAfter) }
    );
  }
  if (isGitHubAuthError(githubError)) {
    session?.destroy();
    return json(401, { error: "Your GitHub sign-in ended — sign in again", code: "reauth" });
  }
  if (err instanceof TransactionConflictError) {
    return json(503, { error: "Your library is busy — try again", code: "busy" }, { "Retry-After": "2" });
  }
  if (err instanceof CorruptJsonError) {
    return json(500, { error: err.message, code: "corrupt_manifest" });
  }
  if (isGitHubUnreachable(githubError)) {
    return json(502, { error: "Couldn't reach GitHub — try again", code: "github_unavailable" });
  }

  const status = githubStatus(githubError);
  if (status !== undefined && status >= 500) {
    return json(502, { error: "GitHub is having trouble — try again", code: "github_unavailable" });
  }
  if (status === 403 || status === 404 || status === 409 || status === 422) {
    return json(status, { error: `GitHub: ${githubMessage(githubError)}`, code: "github_error" });
  }

  console.error("[404gb] unhandled API error", err);
  return json(500, { error: "Something went wrong — try again" });
}

/** Parses a JSON request body; malformed or missing bodies are a 400. */
export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => undefined);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Expected a JSON object body");
  }
  return body as Record<string, unknown>;
}

type RouteArgs<P> = { params: P };

export interface AuthContext {
  session: IronSession<SessionData>;
  accessToken: string;
}

export interface RepoContext extends AuthContext {
  repo: RepoRef;
}

interface RouteOptions {
  /** Roll the 90-day session forward (at most once a day, via Set-Cookie). */
  renew?: boolean;
}

/** Route handler that needs a signed-in user (no repo required). */
export function withAuth<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: AuthContext, params: P) => Promise<Response>
) {
  return async (req: NextRequest, args: RouteArgs<P>): Promise<Response> => {
    let session: IronSession<SessionData> | null = null;
    try {
      session = await getSession();
      if (!session.accessToken) return json(401, { error: "not authenticated", code: "signed_out" });
      return await handler(req, { session, accessToken: session.accessToken }, args?.params);
    } catch (err) {
      return errorResponse(err, session);
    }
  };
}

/** Route handler that needs a signed-in user with a storage repo selected. */
export function withRepo<P = Record<string, string>>(
  handler: (req: NextRequest, ctx: RepoContext, params: P) => Promise<Response>,
  options: RouteOptions = {}
) {
  return async (req: NextRequest, args: RouteArgs<P>): Promise<Response> => {
    let session: IronSession<SessionData> | null = null;
    try {
      session = await getSession();
      const { accessToken, repoOwner, repoName } = session;
      if (!accessToken) return json(401, { error: "not authenticated", code: "signed_out" });
      if (!repoOwner || !repoName) {
        return json(401, { error: "no storage repo selected", code: "no_repo" });
      }

      let dirty = false;
      let branch = session.repoBranch;
      if (!branch) {
        branch = await getDefaultBranch(accessToken, repoOwner, repoName);
        session.repoBranch = branch;
        dirty = true;
      }
      if (options.renew && renewSessionIfStale(session)) dirty = true;
      if (dirty) await session.save();

      const repo: RepoRef = { accessToken, owner: repoOwner, repo: repoName, branch };
      return await handler(req, { session, accessToken, repo }, args?.params);
    } catch (err) {
      return errorResponse(err, session);
    }
  };
}
