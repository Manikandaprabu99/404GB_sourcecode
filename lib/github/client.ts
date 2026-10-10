import { Octokit } from "@octokit/rest";
import { githubStatus } from "./errors";

export function getOctokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

/** Everything a server call needs to address the signed-in user's storage repo. */
export interface RepoRef {
  accessToken: string;
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

/** Object path convention: objects/<hash[0:2]>/<hash> */
export function objectPathForHash(hash: string): string {
  return `objects/${hash.slice(0, 2)}/${hash}`;
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (body === null || body === undefined) return Buffer.alloc(0);
  return Buffer.from(await new Response(body as BodyInit).arrayBuffer());
}

// Raw bytes in one call up to 100 MB (the JSON form leaves `content` empty above 1 MB).
const RAW_REQUEST = {
  mediaType: { format: "raw" },
  request: { parseSuccessResponseBody: false },
} as const;

/** Raw bytes of the file at `path` on `ref` (default branch when omitted), or null if absent. */
export async function fetchRawContent(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<Buffer | null> {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
      ...RAW_REQUEST,
    });
    return await bodyToBuffer(res.data);
  } catch (err) {
    if (githubStatus(err) === 404) return null;
    throw err;
  }
}

/** Raw bytes of one blob by sha. */
export async function fetchRawBlob(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string
): Promise<Buffer> {
  const res = await octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
    owner,
    repo,
    file_sha: sha,
    ...RAW_REQUEST,
  });
  return bodyToBuffer(res.data);
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
