import { Octokit } from "@octokit/rest";

export const OAUTH_SCOPE = "repo";

export function getOctokit(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

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

/**
 * Ensure the required 404GB folder structure exists in a repo:
 * manifest/media-index.json (empty array) and manifest/albums.json (empty array).
 * Committed via the Contents API (simple, low-frequency, not perf sensitive).
 */
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
  } catch (err: any) {
    if (err?.status === 404) return false;
    throw err;
  }
}

export async function getContentJson<T>(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<T | null> {
  const octokit = getOctokit(accessToken);
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || !("content" in data)) return null;
    const buf = Buffer.from(data.content, "base64");
    return JSON.parse(buf.toString("utf-8")) as T;
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

export async function getContentBinary(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<Uint8Array | null> {
  const octokit = getOctokit(accessToken);
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || !("content" in data)) return null;
    return new Uint8Array(Buffer.from(data.content, "base64"));
  } catch (err: any) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Object path convention: objects/<hash[0:2]>/<hash> */
export function objectPathForHash(hash: string): string {
  return `objects/${hash.slice(0, 2)}/${hash}`;
}

export interface BlobInput {
  path: string;
  base64Content?: string;
  /** Use an already-created blob sha (e.g. a chunk uploaded via /api/media/upload/chunk) instead of content. */
  sha?: string;
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

/**
 * Create a single commit containing multiple blobs (chunk objects + metadata +
 * manifest) using the Git Data API: create blobs -> create tree -> create
 * commit -> update ref. Batches everything so an N-chunk upload is O(1)
 * commits regardless of N.
 */
export async function commitBlobs(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  blobs: BlobInput[],
  commitMessage: string
): Promise<string> {
  const octokit = getOctokit(accessToken);

  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const baseCommitSha = refData.object.sha;

  const { data: baseCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });
  const baseTreeSha = baseCommit.tree.sha;

  const treeEntries = await Promise.all(
    blobs.map(async (blob) => {
      let sha = blob.sha;
      if (!sha) {
        if (blob.base64Content === undefined) {
          throw new Error(`Blob for ${blob.path} has neither sha nor content`);
        }
        const { data: blobData } = await octokit.git.createBlob({
          owner,
          repo,
          content: blob.base64Content,
          encoding: "base64",
        });
        sha = blobData.sha;
      }
      return {
        path: blob.path,
        mode: "100644" as const,
        type: "blob" as const,
        sha,
      };
    })
  );

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: [baseCommitSha],
  });

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return newCommit.sha;
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
