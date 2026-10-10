import { fetchRawContent, getOctokit, type RepoRef } from "./client";
import { githubStatus } from "./errors";
import { RepoReader } from "./reader";

export {
  getOctokit,
  objectPathForHash,
  fetchRawContent,
  fetchRawBlob,
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
  type TransactionStep,
} from "./transaction";
export { CorruptJsonError, parseJsonArray, serializeJsonArray } from "./jsonArray";
export {
  githubRetryAfterSeconds,
  githubStatus,
  githubMessage,
  isGitHubAuthError,
  isGitHubUnreachable,
  parseRetryAfter,
} from "./errors";

export const OAUTH_SCOPE = "repo";

export interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

/** List repos the authenticated user owns or collaborates on. */
export async function listRepos(accessToken: string): Promise<RepoSummary[]> {
  const octokit = getOctokit(accessToken);
  const { data } = await octokit.repos.listForAuthenticatedUser({
    per_page: 100,
    sort: "updated",
  });
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    owner: r.owner?.login ?? "",
    private: !!r.private,
    defaultBranch: r.default_branch ?? "main",
  }));
}

/** Creates the empty manifest files if missing (create-only: the Contents API refuses to overwrite without a sha). */
export async function initRepoStructure(
  accessToken: string,
  owner: string,
  repo: string
): Promise<void> {
  const octokit = getOctokit(accessToken);

  const filesToEnsure: Array<{ path: string; content: string }> = [
    { path: "manifest/media-index.json", content: "[]\n" },
    { path: "manifest/albums.json", content: "[]\n" },
  ];

  for (const file of filesToEnsure) {
    const exists = await contentsExists(accessToken, owner, repo, file.path);
    if (exists) continue;
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      message: `404gb: initialize ${file.path}`,
      content: Buffer.from(file.content, "utf-8").toString("base64"),
    });
  }
}

export async function contentsExists(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<boolean> {
  const octokit = getOctokit(accessToken);
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch (err) {
    if (githubStatus(err) === 404) return false;
    throw err;
  }
}

/** A JSON file's parsed content (null when absent or unparseable). One API call. */
export async function getContentJson<T>(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<T | null> {
  const buf = await fetchRawContent(getOctokit(accessToken), owner, repo, path);
  if (!buf) return null;
  try {
    return JSON.parse(buf.toString("utf-8")) as T;
  } catch {
    return null;
  }
}

/** A file's raw bytes (null when absent). One API call, files up to 100 MB. */
export async function getContentBinary(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<Uint8Array<ArrayBuffer> | null> {
  const buf = await fetchRawContent(getOctokit(accessToken), owner, repo, path);
  // fetchRawContent wraps a fresh, unshared ArrayBuffer, so this is a zero-copy view.
  return buf ? new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength) : null;
}

/** Create a single Git blob (used to upload one chunk object ahead of the final commit). */
export async function createBlob(
  accessToken: string,
  owner: string,
  repo: string,
  base64Content: string
): Promise<string> {
  const octokit = getOctokit(accessToken);
  const { data } = await octokit.git.createBlob({
    owner,
    repo,
    content: base64Content,
    encoding: "base64",
  });
  return data.sha;
}

export async function getDefaultBranch(
  accessToken: string,
  owner: string,
  repo: string
): Promise<string> {
  const octokit = getOctokit(accessToken);
  const { data } = await octokit.repos.get({ owner, repo });
  return data.default_branch;
}

/** The branch's current commit sha: one small refs call (the sync check's basis). */
export async function getHeadSha(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string> {
  const octokit = getOctokit(accessToken);
  const { data } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  return data.object.sha;
}

/** Reader for the latest state of the branch (no snapshot consistency). */
export function branchReader(repo: RepoRef): RepoReader {
  return new RepoReader(getOctokit(repo.accessToken), repo.owner, repo.repo, repo.branch, repo.branch);
}

/** Reader pinned to one commit. */
export function commitReader(repo: RepoRef, commitSha: string): RepoReader {
  return new RepoReader(getOctokit(repo.accessToken), repo.owner, repo.repo, commitSha, commitSha);
}
