// Small JSON fetch helper for the library UI: classifies failures so screens can
// tell "signed out" from "rate limited" from "offline" from a real server error.

export type ApiErrorKind = "offline" | "auth" | "rate-limit" | "not-found" | "server";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly retryAfterSec?: number;

  constructor(kind: ApiErrorKind, message: string, status: number, retryAfterSec?: number) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export interface LibraryError {
  kind: ApiErrorKind;
  message: string;
  retryAfterSec?: number;
}

export function toLibraryError(err: unknown): LibraryError {
  if (err instanceof ApiError) {
    return { kind: err.kind, message: err.message, retryAfterSec: err.retryAfterSec };
  }
  return { kind: "server", message: err instanceof Error ? err.message : String(err) };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

export function rateLimitMessage(retryAfterSec?: number): string {
  if (retryAfterSec === undefined) return "GitHub is limiting requests right now. Try again in a few minutes.";
  if (retryAfterSec < 90) return "GitHub is limiting requests right now. Try again in a minute.";
  return `GitHub is limiting requests right now. Try again in about ${Math.ceil(retryAfterSec / 60)} minutes.`;
}

export interface ApiRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-serialized as the request body. */
  body?: unknown;
  keepalive?: boolean;
  signal?: AbortSignal;
}

export async function apiJson<T>(url: string, request: ApiRequest = {}): Promise<T> {
  const { method = "GET", body, keepalive, signal } = request;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      keepalive,
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("offline", "You're offline.", 0);
  }

  if (res.ok) {
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  const payload = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const serverMessage = typeof payload?.error === "string" ? payload.error : null;
  if (res.status === 401) throw new ApiError("auth", "You're signed out.", 401);
  if (res.status === 429) {
    const retryAfterSec = parseRetryAfter(res.headers.get("Retry-After"));
    throw new ApiError("rate-limit", rateLimitMessage(retryAfterSec), 429, retryAfterSec);
  }
  if (res.status === 404) throw new ApiError("not-found", serverMessage ?? "Not found.", 404);
  throw new ApiError(
    "server",
    serverMessage ?? `Something went wrong (${res.status}).`,
    res.status,
    res.status === 503 ? parseRetryAfter(res.headers.get("Retry-After")) : undefined
  );
}

const BUSY_RETRIES = 2;

/** Retries a write the server turned away because the library was mid-commit (503). */
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
