import { mapWithConcurrency } from "@/lib/concurrency";
import { gitBlobSha, putCachedBlobText } from "./blobCache";
import { utf8Length } from "./bytes";
import { githubJson, headsRef, repoPath, type RepoRef } from "./client";
import { githubStatus } from "./errors";
import { RepoReader } from "./reader";

export interface BlobInput {
  path: string;
  /** UTF-8 text (JSON files). Small texts ride inline in the tree request. */
  text?: string;
  /** Binary content, base64-encoded. */
  base64Content?: string;
  /** An already-created blob, e.g. a chunk uploaded with createBlob. */
  sha?: string;
  /** Removes the path; GitHub rejects this for paths missing from the base tree. */
  delete?: true;
}

export interface TransactionStep<R> {
  result: R;
  /** Omit (or leave `blobs` empty) when nothing needs to change. */
  commit?: { blobs: BlobInput[]; message: string };
}

export interface TransactionResult<R> {
  result: R;
  /** The new commit, or null when the step changed nothing. */
  commitSha: string | null;
  /** The commit the step was built on (the new commit's parent). */
  parentSha: string;
}

/** The branch kept moving under concurrent writes; safe to retry. */
export class TransactionConflictError extends Error {
  constructor(branch: string) {
    super(`${branch} kept changing under concurrent writes`);
    this.name = "TransactionConflictError";
  }
}

/** GitHub refused the new tree, e.g. because a referenced blob sha doesn't exist. */
export class TreeWriteError extends Error {
  constructor(readonly githubError: unknown) {
    super("GitHub rejected the new tree");
    this.name = "TreeWriteError";
  }
}

/** A consistent view of the branch at one commit; what a transaction step reads from. */
export class Snapshot extends RepoReader {
  constructor(
    token: string,
    owner: string,
    repo: string,
    readonly commitSha: string,
    readonly treeSha: string
  ) {
    super(token, owner, repo, commitSha, treeSha);
  }
}

const DEFAULT_MAX_ATTEMPTS = 6;
const INLINE_TEXT_MAX_BYTES = 512 * 1024;
const INLINE_TOTAL_MAX_BYTES = 4 * 1024 * 1024;
const BLOB_CREATE_CONCURRENCY = 4;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafePath(path: string): void {
  const segments = path.split("/");
  const ok = segments.every((s) => SAFE_SEGMENT.test(s) && s !== "." && s !== "..");
  if (!ok) throw new Error(`Refusing to write unsafe repo path: ${path}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TreeItem = {
  path: string;
  mode: "100644";
  type: "blob";
  sha?: string | null;
  content?: string;
};

async function buildTreeItems(repo: RepoRef, blobs: BlobInput[]): Promise<TreeItem[]> {
  let inlineBudget = INLINE_TOTAL_MAX_BYTES;
  const inline = blobs.map((blob) => {
    if (blob.text === undefined || blob.sha || blob.delete) return false;
    const bytes = utf8Length(blob.text);
    if (bytes > INLINE_TEXT_MAX_BYTES || bytes > inlineBudget) return false;
    inlineBudget -= bytes;
    return true;
  });

  return mapWithConcurrency(blobs, BLOB_CREATE_CONCURRENCY, async (blob, i): Promise<TreeItem> => {
    assertSafePath(blob.path);
    const base = { path: blob.path, mode: "100644" as const, type: "blob" as const };
    if (blob.delete) return { ...base, sha: null };
    if (blob.sha) return { ...base, sha: blob.sha };
    if (blob.text !== undefined && inline[i]) return { ...base, content: blob.text };

    const content = blob.text ?? blob.base64Content;
    if (content === undefined) throw new Error(`Blob for ${blob.path} has no content`);
    const data = await githubJson<{ sha: string }>(repo.token, repoPath(repo.owner, repo.repo, "/git/blobs"), {
      method: "POST",
      body: { content, encoding: blob.text !== undefined ? "utf-8" : "base64" },
    });
    return { ...base, sha: data.sha };
  });
}

/** Race-safe read-modify-write: builds on a head snapshot, lands only as its fast-forward, else rebuilds. */
export async function runTransaction<R>(
  repo: RepoRef,
  build: (snapshot: Snapshot) => Promise<TransactionStep<R>>,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
): Promise<TransactionResult<R>> {
  const { token, owner, repo: name, branch } = repo;
  const path = (rest: string) => repoPath(owner, name, rest);

  for (let attempt = 1; ; attempt++) {
    const ref = await githubJson<{ object: { sha: string } }>(token, path(`/git/ref/${headsRef(branch)}`));
    const commitSha = ref.object.sha;
    const commit = await githubJson<{ tree: { sha: string } }>(token, path(`/git/commits/${commitSha}`));

    const step = await build(new Snapshot(token, owner, name, commitSha, commit.tree.sha));
    if (!step.commit || step.commit.blobs.length === 0) {
      return { result: step.result, commitSha: null, parentSha: commitSha };
    }

    const tree = await buildTreeItems(repo, step.commit.blobs);
    let newTreeSha: string;
    try {
      const data = await githubJson<{ sha: string }>(token, path("/git/trees"), {
        method: "POST",
        body: { base_tree: commit.tree.sha, tree },
      });
      newTreeSha = data.sha;
    } catch (err) {
      const status = githubStatus(err);
      if (status === 422 || status === 404) throw new TreeWriteError(err);
      throw err;
    }

    const newCommit = await githubJson<{ sha: string }>(token, path("/git/commits"), {
      method: "POST",
      body: { message: step.commit.message, tree: newTreeSha, parents: [commitSha] },
    });

    try {
      await githubJson(token, path(`/git/refs/${headsRef(branch)}`), {
        method: "PATCH",
        body: { sha: newCommit.sha, force: false },
      });
    } catch (err) {
      const status = githubStatus(err);
      // 422 "not a fast forward" (sometimes 409): the branch moved since the ref was read.
      if (status !== 422 && status !== 409) throw err;
      if (attempt >= maxAttempts) throw new TransactionConflictError(branch);
      await sleep(200 * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
      continue;
    }

    // The next transaction will likely read these files back at the new head.
    for (const blob of step.commit.blobs) {
      const text = blob.text;
      if (text !== undefined) void gitBlobSha(text).then((sha) => putCachedBlobText(sha, text), () => {});
    }
    return { result: step.result, commitSha: newCommit.sha, parentSha: commitSha };
  }
}
