import { bytesToBase64, utf8Bytes, type Bytes } from "./bytes";
import {
  encodePath,
  fetchRawContent,
  githubErrorFrom,
  githubFetch,
  githubJson,
  githubJsonOrNull,
  headsRef,
  repoPath,
  type RepoRef,
} from "./client";
import { githubStatus } from "./errors";
import { RepoReader } from "./reader";

export {
  objectPathForHash,
  fetchRawContent,
  fetchRawBlob,
  githubFetch,
  githubJson,
  setUnauthorizedListener,
  GITHUB_API,
  type RepoRef,
  type TreeEntry,
} from "./client";
export { RepoReader } from "./reader";
export {
  runTransaction,
  Snapshot,
  TransactionConflictError,
  TreeWriteError,
  type BlobInput,
  type TransactionResult,
  type TransactionStep,
} from "./transaction";
export { CorruptJsonError, parseJsonArray, serializeJsonArray } from "./jsonArray";
export {
  GitHubError,
  GitHubNetworkError,
  RepoError,
  githubRetryAfterSeconds,
  githubStatus,
  githubMessage,
  isAbortError,
  isGitHubAuthError,
  isGitHubUnreachable,
  parseRetryAfter,
} from "./errors";
export { bytesToBase64, base64ToBytes, sha256HexOf, utf8Bytes, utf8Text, type Bytes } from "./bytes";

export const OAUTH_SCOPE = "repo";

/** The account a token belongs to, and its OAuth scopes (null for fine-grained tokens, which have none). */
export async function getAuthenticatedUser(token: string): Promise<{ login: string; scopes: string[] | null }> {
  const res = await githubFetch(token, "/user");
  if (!res.ok) throw await githubErrorFrom(res);
  const data = (await res.json()) as { login?: unknown };
  if (typeof data.login !== "string" || !data.login) throw new Error("GitHub didn't say who this token belongs to");
  const scopes = res.headers.get("x-oauth-scopes");
  return {
    login: data.login,
    scopes: scopes === null ? null : scopes.split(",").map((scope) => scope.trim()).filter(Boolean),
  };
}

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

interface RepoResponse {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string } | null;
  private?: boolean;
  default_branch?: string;
}

function toSummary(r: RepoResponse): RepoSummary {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login ?? "",
    private: !!r.private,
    defaultBranch: r.default_branch ?? "main",
  };
}

const REPO_PAGE_SIZE = 100;
const MAX_REPO_PAGES = 10;

/** Repos the authenticated user owns or collaborates on, most recently updated first. */
export async function listRepos(token: string): Promise<RepoSummary[]> {
  const repos: RepoSummary[] = [];
  for (let page = 1; page <= MAX_REPO_PAGES; page++) {
    const res = await githubFetch(token, `/user/repos?per_page=${REPO_PAGE_SIZE}&sort=updated&page=${page}`);
    if (!res.ok) throw await githubErrorFrom(res);
    const data = (await res.json()) as RepoResponse[];
    repos.push(...data.map(toSummary));
    const link = res.headers.get("link");
    const hasNext = link !== null ? /rel="next"/.test(link) : data.length === REPO_PAGE_SIZE;
    if (!hasNext) break;
  }
  return repos;
}

/** Creates a private repo with an initial commit, so its default branch exists. */
export async function createRepo(token: string, name: string): Promise<RepoSummary> {
  const data = await githubJson<RepoResponse>(token, "/user/repos", {
    method: "POST",
    body: { name, private: true, auto_init: true, description: "404GB photo storage repo" },
  });
  return toSummary(data);
}

export async function getDefaultBranch(token: string, owner: string, repo: string): Promise<string> {
  const data = await githubJson<{ default_branch?: string }>(token, repoPath(owner, repo));
  return data.default_branch || "main";
}

export async function contentsExists(token: string, owner: string, repo: string, path: string): Promise<boolean> {
  const data = await githubJsonOrNull<unknown>(token, repoPath(owner, repo, `/contents/${encodePath(path)}`));
  return data !== null;
}

const INIT_ATTEMPTS = 5;

/** Creates the empty manifest files if missing (create-only: the Contents API refuses to overwrite without a sha). */
export async function initRepoStructure(token: string, owner: string, repo: string): Promise<void> {
  const filesToEnsure: Array<{ path: string; content: string }> = [
    { path: "manifest/media-index.json", content: "[]\n" },
    { path: "manifest/albums.json", content: "[]\n" },
  ];

  for (const file of filesToEnsure) {
    for (let attempt = 1; ; attempt++) {
      try {
        if (await contentsExists(token, owner, repo, file.path)) break;
        await githubJson(token, repoPath(owner, repo, `/contents/${encodePath(file.path)}`), {
          method: "PUT",
          body: { message: `404gb: initialize ${file.path}`, content: bytesToBase64(utf8Bytes(file.content)) },
        });
        break;
      } catch (err) {
        const status = githubStatus(err);
        // 422: it was created meanwhile. 404/409: a just-created repo isn't writable for a moment.
        if (status === 422) break;
        if ((status !== 404 && status !== 409) || attempt >= INIT_ATTEMPTS) throw err;
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }
}

export type HeadCheck = { modified: true; sha: string; etag: string | null } | { modified: false };

/** The branch's current commit sha: one small refs call (a 304 for `etag` costs no rate limit). */
export async function getHead(repo: RepoRef, etag?: string): Promise<HeadCheck> {
  const res = await githubFetch(repo.token, repoPath(repo.owner, repo.repo, `/git/ref/${headsRef(repo.branch)}`), {
    etag,
  });
  if (res.status === 304) return { modified: false };
  if (!res.ok) throw await githubErrorFrom(res);
  const data = (await res.json()) as { object?: { sha?: string } };
  if (!data.object?.sha) throw new Error(`${repo.branch} has no commit`);
  return { modified: true, sha: data.object.sha, etag: res.headers.get("etag") };
}

/** A file's raw bytes at `ref` (the branch head when omitted), or null when absent. */
export function getContentBinary(repo: RepoRef, path: string, ref?: string, signal?: AbortSignal): Promise<Bytes | null> {
  return fetchRawContent(repo.token, repo.owner, repo.repo, path, ref ?? repo.branch, signal);
}

/** Creates one Git blob from base64 content (a chunk or thumbnail, referenced by a later commit). */
export async function createBlob(repo: RepoRef, base64Content: string, signal?: AbortSignal): Promise<string> {
  const data = await githubJson<{ sha: string }>(repo.token, repoPath(repo.owner, repo.repo, "/git/blobs"), {
    method: "POST",
    body: { content: base64Content, encoding: "base64" },
    signal,
  });
  return data.sha;
}

/** Reader for the latest state of the branch (no snapshot consistency). */
export function branchReader(repo: RepoRef): RepoReader {
  return new RepoReader(repo.token, repo.owner, repo.repo, repo.branch, repo.branch);
}

/** Reader pinned to one commit. */
export function commitReader(repo: RepoRef, commitSha: string): RepoReader {
  return new RepoReader(repo.token, repo.owner, repo.repo, commitSha, commitSha);
}
