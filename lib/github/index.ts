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

/**
 * Read a file's actual bytes via the Git Data API's blob endpoint (base64,
 * supports files up to 100MB) instead of the Contents API's inline `content`
 * field.
 *
 * This matters because octokit.repos.getContent(), with the default JSON
 * media type, only returns real base64 content for files <=1MB. For files
 * between 1MB and 100MB it returns `{ content: "", encoding: "none" }` —
 * present-but-empty, not truncated, not a 404 — so a naive
 * `Buffer.from(data.content, "base64")` silently produces a valid-looking
 * *empty* buffer instead of throwing or returning null. DEFAULT_CHUNK_SIZE
 * (lib/chunking) is 4 MiB, so every full-size chunk object, and any
 * single-chunk file over 1MB, would hit that trap and get served/reconstructed
 * as 0 bytes.
 *
 * We first resolve the file's blob sha via getContent's metadata (present
 * regardless of size), then fetch its real content via git.getBlob(sha),
 * which returns full base64 content for anything up to 100MB — the same API
 * createBlob() already writes through, so read/write use the same size
 * ceiling.
 */
async function getBlobBuffer(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<Buffer | null> {
  const { data: meta } = await octokit.repos.getContent({ owner, repo, path });
  if (Array.isArray(meta) || !("sha" in meta)) return null;

  const { data: blob } = await octokit.git.getBlob({
    owner,
    repo,
    file_sha: meta.sha,
  });
  if (blob.encoding !== "base64") return null;
  return Buffer.from(blob.content, "base64");
}

export async function getContentJson<T>(
  accessToken: string,
  owner: string,
  repo: string,
  path: string
): Promise<T | null> {
  const octokit = getOctokit(accessToken);
  try {
    const buf = await getBlobBuffer(octokit, owner, repo, path);
    if (!buf) return null;
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
    const buf = await getBlobBuffer(octokit, owner, repo, path);
    if (!buf) return null;
    return new Uint8Array(buf);
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
  /**
   * Removes `path` from the tree instead of writing to it — the Git Data
   * API's create-tree endpoint deletes a path when its tree entry's `sha` is
   * `null` (mutually exclusive with `base64Content`/`sha` above). Used by
   * lib/media.deleteMedia to remove a metadata/<id>.json file as part of the
   * same batched commit that also updates manifest/media-index.json,
   * without touching objects/ or thumbnails/.
   *
   * Note: GitHub's create-tree API errors if asked to delete a path that
   * isn't actually present in `base_tree` — callers must only set this for
   * paths they've confirmed exist.
   */
  delete?: true;
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

/** Shared by commitBlobs and commitBlobsWithManifestUpdate: turns a list of
 * BlobInputs into Git Data API tree entries, creating any blob that was
 * given as raw content rather than an existing sha. */
async function buildTreeEntries(
  octokit: Octokit,
  owner: string,
  repo: string,
  blobs: BlobInput[]
) {
  return Promise.all(
    blobs.map(async (blob) => {
      if (blob.delete) {
        // sha: null is how the Git Data API's create-tree endpoint removes
        // a path — see the BlobInput.delete doc comment.
        return {
          path: blob.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: null,
        };
      }

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
}

/**
 * Create a single commit containing multiple blobs (chunk objects + metadata +
 * manifest) using the Git Data API: create blobs -> create tree -> create
 * commit -> update ref. Batches everything so an N-chunk upload is O(1)
 * commits regardless of N.
 *
 * NOTE: every blob's content here (including any manifest file included in
 * `blobs`) must already be final — this function does not re-read anything
 * from the branch, it just bakes `blobs` on top of whatever base_tree it
 * happens to fetch. A caller that computes a manifest file's new content by
 * reading-modifying-writing an existing one (e.g. removing some entries from
 * it) has a lost-update race if another commit could land on the branch
 * between that read and this call's own getRef — see
 * commitBlobsWithManifestUpdate below, which closes that gap.
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

  const treeEntries = await buildTreeEntries(octokit, owner, repo, blobs);

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

/** What commitBlobsWithManifestUpdate hands its `buildBlobs` callback: the
 * manifest's content as of the exact base_tree this attempt is about to
 * commit against (empty array if the path doesn't exist yet), and a lookup
 * for whether some other path already exists in that same base_tree (so a
 * caller that needs to guard a `delete: true` entry — see BlobInput.delete's
 * doc comment — can check existence without a separate, independently-racy
 * network call). */
type ManifestBuilder<T> = (
  freshManifest: T[],
  pathExists: (path: string) => boolean
) => { blobs: BlobInput[]; updatedManifest: T[]; commitMessage: string } | null;

/**
 * Like commitBlobs, but for the common read-modify-write shape: a commit
 * that rewrites a JSON manifest file (e.g. manifest/media-index.json) based
 * on that file's *current* content. Fixes a lost-update race that a naive
 * "read the manifest once, build the new content, then call commitBlobs"
 * caller has: commitBlobs fetches its own, independently-current base_tree,
 * so if anything else committed to the branch (and touched the manifest)
 * between the caller's read and commitBlobs' own getRef, that other change
 * gets silently overwritten even though the resulting commit looks like a
 * perfectly valid fast-forward.
 *
 * Instead, this function fetches the branch head and the manifest's content
 * *at that exact tree* together, hands them to `buildBlobs` so it can
 * compute the new manifest content from a snapshot that's guaranteed to
 * match the tree the commit will actually be based on, and — if updateRef
 * rejects the commit because the branch head moved in the meantime (another
 * write landed after this attempt's getRef but before its updateRef) —
 * retries the whole read+recompute against the new head, up to
 * `maxAttempts` times, rather than ever writing a manifest computed from a
 * snapshot that's known to be stale.
 *
 * `buildBlobs` returning null aborts without committing (e.g. "none of the
 * requested ids are present in the manifest, so there's nothing to do") —
 * useful for a caller that decides whether there's anything to do based on
 * the very state this function fetches fresh, and would otherwise have to
 * take a separate speculative read of its own.
 */
export async function commitBlobsWithManifestUpdate<T>(
  accessToken: string,
  owner: string,
  repo: string,
  branch: string,
  manifestPath: string,
  buildBlobs: ManifestBuilder<T>,
  maxAttempts = 5
): Promise<string | null> {
  const octokit = getOctokit(accessToken);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

    // Recursive so nested paths (manifest/…, metadata/…) show up in one
    // listing — same tree the commit below will be based on, so both the
    // manifest's fresh content and the existence checks `buildBlobs` gets
    // are guaranteed consistent with base_tree, not a separately-fetched
    // (and possibly newer or older) view of the repo.
    const { data: fullTree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: baseTreeSha,
      recursive: "true",
    });
    const pathShas = new Map<string, string>();
    for (const entry of fullTree.tree) {
      if (entry.type === "blob" && entry.path && entry.sha) {
        pathShas.set(entry.path, entry.sha);
      }
    }

    let freshManifest: T[] = [];
    const manifestSha = pathShas.get(manifestPath);
    if (manifestSha) {
      const { data: blob } = await octokit.git.getBlob({
        owner,
        repo,
        file_sha: manifestSha,
      });
      if (blob.encoding === "base64") {
        try {
          freshManifest = JSON.parse(
            Buffer.from(blob.content, "base64").toString("utf-8")
          ) as T[];
        } catch {
          freshManifest = [];
        }
      }
    }

    const built = buildBlobs(freshManifest, (path) => pathShas.has(path));
    if (!built) return null;

    const allBlobs: BlobInput[] = [
      ...built.blobs,
      {
        path: manifestPath,
        base64Content: Buffer.from(
          JSON.stringify(built.updatedManifest, null, 2)
        ).toString("base64"),
      },
    ];

    const treeEntries = await buildTreeEntries(octokit, owner, repo, allBlobs);

    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeEntries,
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: built.commitMessage,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    try {
      await octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.sha,
      });
      return newCommit.sha;
    } catch (err: any) {
      // GitHub rejects updateRef (422, "not a fast forward" — sometimes
      // surfaced as 409) when the branch moved since this attempt's getRef.
      // That means our freshManifest snapshot is now stale too, so retry the
      // whole read+recompute against the new head rather than force-pushing
      // a commit built from outdated data.
      const isFastForwardConflict = err?.status === 422 || err?.status === 409;
      if (isFastForwardConflict && attempt < maxAttempts) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `commitBlobsWithManifestUpdate: gave up after ${maxAttempts} attempts — ` +
      `${branch} kept moving under concurrent writes`
  );
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

/**
 * Cheap "what's the repo's current HEAD commit" check via the Git Data refs
 * API (a single GET, no tree/blob traversal) — the basis of the Section 11
 * sync strategy: the client compares this against its cached lastKnownSha
 * and only re-fetches manifest/media-index.json when it differs.
 */
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
