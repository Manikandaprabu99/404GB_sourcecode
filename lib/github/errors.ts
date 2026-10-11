// Errors from the GitHub REST API (lib/github/client.ts) and how to classify them.

const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 3600;
// GitHub's guidance when a secondary limit gives no retry-after: wait at least a minute.
const DEFAULT_RETRY_SECONDS = 60;

/** A non-2xx answer from GitHub; `response.headers` keys are lowercase. */
export class GitHubError extends Error {
  readonly response: { headers: Record<string, string>; data: unknown };

  constructor(
    readonly status: number,
    message: string,
    headers: Record<string, string>,
    data: unknown
  ) {
    super(message);
    this.name = "GitHubError";
    this.response = { headers, data };
  }
}

/** fetch() itself failed (offline, DNS, dropped connection): no HTTP answer at all. */
export class GitHubNetworkError extends Error {
  constructor(cause?: unknown) {
    super("Couldn't reach GitHub", cause !== undefined ? { cause } : undefined);
    this.name = "GitHubNetworkError";
  }
}

/** A request this app refuses (bad input, missing item), with a status and a message safe to show. */
export class RepoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RepoError";
  }
}

export function githubStatus(err: unknown): number | undefined {
  return err instanceof GitHubError ? err.status : undefined;
}

function header(err: GitHubError, name: string): string | undefined {
  return err.response.headers[name];
}

export function githubMessage(err: unknown): string {
  if (err instanceof GitHubError) {
    const data = err.response.data;
    if (data && typeof data === "object" && "message" in data) {
      const message = (data as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

function clampSeconds(seconds: number): number {
  return Math.min(MAX_RETRY_SECONDS, Math.max(MIN_RETRY_SECONDS, Math.ceil(seconds)));
}

/** Parses a Retry-After value (delta seconds or an HTTP date) into seconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return clampSeconds(Number(trimmed));
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return clampSeconds((date - now) / 1000);
}

/** Seconds to wait when `err` is a GitHub primary or secondary rate limit, otherwise null. */
export function githubRetryAfterSeconds(err: unknown, now = Date.now()): number | null {
  if (!(err instanceof GitHubError)) return null;
  if (err.status !== 403 && err.status !== 429) return null;

  const retryAfter = parseRetryAfter(header(err, "retry-after"), now);
  if (retryAfter !== null) return retryAfter;

  if (header(err, "x-ratelimit-remaining") === "0") {
    const reset = Number(header(err, "x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return clampSeconds(reset - now / 1000 + 1);
    return DEFAULT_RETRY_SECONDS;
  }

  if (err.status === 429 || /rate limit|abuse detection/i.test(githubMessage(err))) {
    return DEFAULT_RETRY_SECONDS;
  }
  return null;
}

/** True when GitHub rejected the token itself (revoked, expired or mistyped). */
export function isGitHubAuthError(err: unknown): boolean {
  return githubStatus(err) === 401;
}

export function isGitHubUnreachable(err: unknown): boolean {
  return err instanceof GitHubNetworkError;
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) && err.name === "AbortError";
}
