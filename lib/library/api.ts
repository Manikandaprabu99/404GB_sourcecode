// How the library UI talks to the storage repo: every operation runs through withRepo (or
// withToken), which supplies the signed-in session and turns whatever went wrong into an
// ApiError, so screens can tell "signed out" from "rate limited" from "offline" from a
// real failure.

import {
  CorruptJsonError,
  getDefaultBranch,
  githubMessage,
  githubRetryAfterSeconds,
  githubStatus,
  isAbortError,
  isGitHubAuthError,
  isGitHubUnreachable,
  RepoError,
  TransactionConflictError,
  TreeWriteError,
  type RepoRef,
} from "@/lib/github";
import { getSession, loadSession, setBranch } from "@/lib/session";

export type ApiErrorKind = "offline" | "auth" | "rate-limit" | "not-found" | "server";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly retryAfterSec?: number;
  /** Machine-readable code, e.g. "reauth", "signed_out" or "no_repo" on a 401, "busy" on a 503. */
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number,
    retryAfterSec?: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.code = code;
    this.details = details;
  }
}

export interface LibraryError {
  kind: ApiErrorKind;
  message: string;
  retryAfterSec?: number;
  code?: string;
}

export function toLibraryError(err: unknown): LibraryError {
  if (err instanceof ApiError) {
    return { kind: err.kind, message: err.message, retryAfterSec: err.retryAfterSec, code: err.code };
  }
  return { kind: "server", message: err instanceof Error ? err.message : String(err) };
}

export function rateLimitMessage(retryAfterSec?: number): string {
  if (retryAfterSec === undefined) return "GitHub is limiting requests right now. Try again in a few minutes.";
  if (retryAfterSec < 90) return "GitHub is limiting requests right now. Try again in a minute.";
  return `GitHub is limiting requests right now. Try again in about ${Math.ceil(retryAfterSec / 60)} minutes.`;
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return "auth";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limit";
  return "server";
}

/** Any thrown error as an ApiError; GitHub rate limits become "rate-limit" with the wait in seconds. */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof RepoError) {
    return new ApiError(kindForStatus(err.status), err.message, err.status, undefined, err.code, err.details);
  }
  const githubError = err instanceof TreeWriteError ? err.githubError : err;

  const retryAfter = githubRetryAfterSeconds(githubError);
  if (retryAfter !== null) {
    return new ApiError("rate-limit", rateLimitMessage(retryAfter), 429, retryAfter, "rate_limited");
  }
  if (isGitHubAuthError(githubError)) {
    return new ApiError("auth", "Your GitHub sign-in ended — sign in again.", 401, undefined, "reauth");
  }
  if (err instanceof TransactionConflictError) {
    return new ApiError("server", "Your library is busy — try again", 503, 2, "busy");
  }
  if (err instanceof CorruptJsonError) {
    return new ApiError("server", err.message, 500, undefined, "corrupt_manifest");
  }
  if (err instanceof Error && (err.name === "MediaIntegrityError" || err.name === "ChunkIntegrityError")) {
    return new ApiError("server", "The download didn't come through intact. Try again.", 502, undefined, "integrity");
  }
  if (isGitHubUnreachable(githubError)) {
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return new ApiError("offline", offline ? "You're offline." : "Couldn't reach GitHub. Check your connection.", 0);
  }

  const status = githubStatus(githubError);
  if (status !== undefined && status >= 500) {
    return new ApiError("server", "GitHub is having trouble — try again", 502, undefined, "github_unavailable");
  }
  if (status === 403 || status === 404 || status === 409 || status === 422) {
    return new ApiError(kindForStatus(status), `GitHub: ${githubMessage(githubError)}`, status, undefined, "github_error");
  }

  console.error("[404gb] unexpected error", err);
  return new ApiError("server", "Something went wrong — try again", 500);
}

/** Runs `task` with the signed-in token; failures come out as ApiError (aborts stay AbortErrors). */
export async function withToken<T>(task: (token: string) => Promise<T>): Promise<T> {
  await loadSession();
  const { token } = getSession();
  if (!token) throw new ApiError("auth", "You're signed out.", 401, undefined, "signed_out");
  try {
    return await task(token);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw toApiError(err);
  }
}

/**
 * Runs `task` against the selected library (resolving its default branch once if unknown).
 * `repoKey` guards work started for a library the session has since switched away from.
 */
export async function withRepo<T>(task: (repo: RepoRef) => Promise<T>, repoKey?: string): Promise<T> {
  await loadSession();
  const { token, owner, repo, branch } = getSession();
  if (!token) throw new ApiError("auth", "You're signed out.", 401, undefined, "signed_out");
  if (!owner || !repo) throw new ApiError("auth", "No storage repo selected.", 401, undefined, "no_repo");
  if (repoKey && repoKey !== `${owner}/${repo}`) {
    throw new ApiError("server", "You switched to another library.", 409, undefined, "repo_changed");
  }
  try {
    let resolved = branch;
    if (!resolved) {
      resolved = await getDefaultBranch(token, owner, repo);
      setBranch(resolved);
    }
    return await task({ token, owner, repo, branch: resolved });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw toApiError(err);
  }
}

const BUSY_RETRIES = 2;

/** Retries a write that lost the race against other writers too many times (503 "busy"). */
export async function retryWhenBusy<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 503 || attempt >= BUSY_RETRIES) throw err;
      const waitMs = Math.min(10, err.retryAfterSec ?? 2) * 1000 + Math.random() * 400;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/** Splits `items` into consecutive batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
