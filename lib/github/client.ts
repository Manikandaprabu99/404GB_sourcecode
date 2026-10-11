// Minimal GitHub REST client on fetch(): api.github.com sends CORS headers for any
// origin, so the app (https://localhost in the WebView) and browsers call it directly
// with the user's token. See docs/STANDALONE.md.

import type { Bytes } from "./bytes";
import { GitHubError, GitHubNetworkError, isAbortError } from "./errors";

export const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const JSON_ACCEPT = "application/vnd.github+json";
const RAW_ACCEPT = "application/vnd.github.raw";

/** Everything a call needs to address the signed-in user's storage repo. */
export interface RepoRef {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface TreeEntry {
  name: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialized as the request body. */
  body?: unknown;
  /** Ask for the raw file bytes (contents and blobs endpoints). */
  raw?: boolean;
  /** Sent as If-None-Match; a 304 answer doesn't count against the rate limit. */
  etag?: string;
  signal?: AbortSignal;
}

let unauthorizedListener: ((token: string) => void) | null = null;

/** Called with the token whenever GitHub answers 401 (lib/session ends that sign-in). */
export function setUnauthorizedListener(listener: ((token: string) => void) | null): void {
  unauthorizedListener = listener;
}

/** Repo-relative path with each segment URL-encoded. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function repoPath(owner: string, repo: string, rest = ""): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${rest}`;
}

/** "heads/<branch>" for the refs endpoints (branch names may contain slashes). */
export function headsRef(branch: string): string {
  return `heads/${encodePath(branch)}`;
}

/** Object path convention: objects/<hash[0:2]>/<hash> */
export function objectPathForHash(hash: string): string {
  return `objects/${hash.slice(0, 2)}/${hash}`;
}

function headersOf(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

async function errorFrom(res: Response): Promise<GitHubError> {
  const data: unknown = await res.json().catch(() => null);
  const message =
    data && typeof data === "object" && typeof (data as { message?: unknown }).message === "string"
      ? (data as { message: string }).message
      : `GitHub answered ${res.status}`;
  return new GitHubError(res.status, message, headersOf(res), data);
}

/** One request; resolves with any HTTP answer (2xx, 304 or an error status). */
export async function githubFetch(token: string, path: string, options: RequestOptions = {}): Promise<Response> {
  const { method = "GET", body, raw, etag, signal } = options;
  const headers: Record<string, string> = {
    Accept: raw ? RAW_ACCEPT : JSON_ACCEPT,
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (etag) headers["If-None-Match"] = etag;

  let res: Response;
  try {
    res = await fetch(path.startsWith("https://") ? path : `${GITHUB_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Reads are cached by the app itself (IndexedDB, Cache Storage); a stale HTTP-cached ref would hide commits.
      cache: "no-store",
      credentials: "omit",
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new GitHubNetworkError(err);
  }
  if (res.status === 401) unauthorizedListener?.(token);
  return res;
}

/** JSON answer of a 2xx request; any other status throws GitHubError. */
export async function githubJson<T>(token: string, path: string, options: RequestOptions = {}): Promise<T> {
  const res = await githubFetch(token, path, options);
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Like githubJson, but a 404 resolves to null. */
export async function githubJsonOrNull<T>(token: string, path: string, options: RequestOptions = {}): Promise<T | null> {
  const res = await githubFetch(token, path, options);
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

export { errorFrom as githubErrorFrom };

/** Raw bytes of the file at `path` on `ref` (default branch when omitted), or null if absent. Up to 100 MB. */
export async function fetchRawContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  signal?: AbortSignal
): Promise<Bytes | null> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  const res = await githubFetch(token, repoPath(owner, repo, `/contents/${encodePath(path)}${query}`), {
    raw: true,
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}

/** Raw bytes of one blob by sha. */
export async function fetchRawBlob(token: string, owner: string, repo: string, sha: string): Promise<Bytes> {
  const res = await githubFetch(token, repoPath(owner, repo, `/git/blobs/${encodeURIComponent(sha)}`), { raw: true });
  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}

export function toTreeEntryMap(
  tree: ReadonlyArray<{ path?: string; type?: string; sha?: string; size?: number }>
): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const item of tree) {
    if (!item.path || !item.sha) continue;
    if (item.type !== "blob" && item.type !== "tree" && item.type !== "commit") continue;
    entries.set(item.path, { name: item.path, type: item.type, sha: item.sha, size: item.size });
  }
  return entries;
}
