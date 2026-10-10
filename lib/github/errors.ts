// Classifies errors thrown by Octokit (RequestError: `status` + `response`).

const MIN_RETRY_SECONDS = 1;
const MAX_RETRY_SECONDS = 3600;
// GitHub's guidance when a secondary limit gives no retry-after: wait at least a minute.
const DEFAULT_RETRY_SECONDS = 60;

interface OctokitLikeError {
  status?: unknown;
  message?: unknown;
  response?: {
    headers?: Record<string, string | number | undefined>;
    data?: unknown;
  };
}

function asOctokitError(err: unknown): OctokitLikeError | null {
  return err && typeof err === "object" ? (err as OctokitLikeError) : null;
}

export function githubStatus(err: unknown): number | undefined {
  const status = asOctokitError(err)?.status;
  return typeof status === "number" ? status : undefined;
}

function header(err: OctokitLikeError, name: string): string | undefined {
  const value = err.response?.headers?.[name];
  return value === undefined ? undefined : String(value);
}

export function githubMessage(err: unknown): string {
  const e = asOctokitError(err);
  if (!e) return String(err);
  const data = e.response?.data;
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return typeof e.message === "string" ? e.message : String(err);
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
  const e = asOctokitError(err);
  if (!e) return null;
  const status = githubStatus(err);
  if (status !== 403 && status !== 429) return null;

  const retryAfter = parseRetryAfter(header(e, "retry-after"), now);
  if (retryAfter !== null) return retryAfter;

  if (header(e, "x-ratelimit-remaining") === "0") {
    const reset = Number(header(e, "x-ratelimit-reset"));
    if (Number.isFinite(reset) && reset > 0) return clampSeconds(reset - now / 1000 + 1);
    return DEFAULT_RETRY_SECONDS;
  }

  if (status === 429 || /rate limit|abuse detection/i.test(githubMessage(err))) {
    return DEFAULT_RETRY_SECONDS;
  }
  return null;
}

/** True when GitHub rejected the stored token itself (revoked or expired). */
export function isGitHubAuthError(err: unknown): boolean {
  return githubStatus(err) === 401;
}

/** Octokit wraps network failures (no HTTP response at all) as status 500 without a response. */
export function isGitHubUnreachable(err: unknown): boolean {
  const e = asOctokitError(err);
  return githubStatus(err) === 500 && !e?.response;
}
