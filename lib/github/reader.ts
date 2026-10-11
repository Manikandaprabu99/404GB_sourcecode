import { mapWithConcurrency } from "@/lib/concurrency";
import { getCachedBlobText, putCachedBlobText } from "./blobCache";
import { base64ToBytes, utf8Text, type Bytes } from "./bytes";
import {
  encodePath,
  fetchRawBlob,
  githubJson,
  githubJsonOrNull,
  repoPath,
  toTreeEntryMap,
  type TreeEntry,
} from "./client";
import { parseJsonArray } from "./jsonArray";

const READ_CONCURRENCY = 8;
// More files than this in one directory: list the directory once instead of one call per file.
const PER_FILE_LOOKUP_LIMIT = 3;
// More objects/<prefix> directories than this: one recursive listing of objects/ instead.
const DIRECT_PREFIX_LIMIT = 12;
// The Contents API silently stops listing a directory at 1,000 entries.
const CONTENTS_DIR_LIMIT = 1000;

function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

interface FileMeta {
  sha: string;
  inline: Bytes | null;
}

interface TreeResponse {
  sha: string;
  truncated?: boolean;
  tree: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
}

interface ContentFile {
  type: string;
  name: string;
  sha: string;
  size: number;
  encoding?: string;
  content?: string;
}

/** Reads the repo as of one `ref`, memoizing listings and lookups: use one per request or attempt. */
export class RepoReader {
  private readonly dirs = new Map<string, Promise<Map<string, TreeEntry> | null>>();
  private readonly metas = new Map<string, Promise<FileMeta | null>>();

  constructor(
    protected readonly token: string,
    protected readonly owner: string,
    protected readonly repo: string,
    /** Commit sha for a consistent snapshot, or a branch name for "latest". */
    readonly ref: string,
    /** Root tree sha; a commit sha or branch name also works since the trees API accepts refs. */
    private readonly rootTree: string
  ) {}

  private path(rest: string): string {
    return repoPath(this.owner, this.repo, rest);
  }

  /** Entries of a directory (non-recursive), or null when it doesn't exist. */
  listDir(dir: string): Promise<Map<string, TreeEntry> | null> {
    let pending = this.dirs.get(dir);
    if (!pending) {
      pending = this.loadDir(dir);
      this.dirs.set(dir, pending);
      pending.catch(() => this.dirs.delete(dir));
    }
    return pending;
  }

  private async loadDir(dir: string): Promise<Map<string, TreeEntry> | null> {
    let treeSha = this.rootTree;
    if (dir) {
      const entry = (await this.listDir(parentDir(dir)))?.get(baseName(dir));
      if (!entry || entry.type !== "tree") return null;
      treeSha = entry.sha;
    }
    const data = await githubJson<TreeResponse>(this.token, this.path(`/git/trees/${encodeURIComponent(treeSha)}`));
    if (data.truncated) throw new Error(`${dir || "The repo root"} has too many entries to list`);
    return toTreeEntryMap(data.tree);
  }

  private fileMeta(path: string): Promise<FileMeta | null> {
    let pending = this.metas.get(path);
    if (!pending) {
      pending = this.loadFileMeta(path);
      this.metas.set(path, pending);
      pending.catch(() => this.metas.delete(path));
    }
    return pending;
  }

  private async loadFileMeta(path: string): Promise<FileMeta | null> {
    const dir = parentDir(path);
    if (this.dirs.has(dir)) {
      const entry = (await this.listDir(dir))?.get(baseName(path));
      return entry?.type === "blob" ? { sha: entry.sha, inline: null } : null;
    }
    const data = await githubJsonOrNull<ContentFile | ContentFile[]>(
      this.token,
      this.path(`/contents/${encodePath(path)}?ref=${encodeURIComponent(this.ref)}`)
    );
    if (!data || Array.isArray(data) || data.type !== "file") return null;
    // Files up to 1 MB come back inline; bigger ones carry only the sha.
    const inline =
      data.encoding === "base64" && typeof data.content === "string" ? base64ToBytes(data.content) : null;
    return { sha: data.sha, inline: inline && inline.length === data.size ? inline : null };
  }

  /** Lists the directories that hold many of `paths`, so lookups below hit the listing. */
  private async primeDirs(paths: readonly string[]): Promise<void> {
    const counts = new Map<string, number>();
    for (const path of paths) counts.set(parentDir(path), (counts.get(parentDir(path)) ?? 0) + 1);
    const dirs = Array.from(counts)
      .filter(([dir, count]) => count > PER_FILE_LOOKUP_LIMIT && !this.dirs.has(dir))
      .map(([dir]) => dir);
    await Promise.all(dirs.map((dir) => this.listDir(dir)));
  }

  async fileSha(path: string): Promise<string | null> {
    return (await this.fileMeta(path))?.sha ?? null;
  }

  /** Blob sha per path (null when absent). */
  async fileShas(paths: readonly string[]): Promise<Map<string, string | null>> {
    const wanted = unique(paths);
    await this.primeDirs(wanted);
    const result = new Map<string, string | null>();
    await mapWithConcurrency(wanted, READ_CONCURRENCY, async (path) => {
      result.set(path, await this.fileSha(path));
    });
    return result;
  }

  private async textOf(meta: FileMeta): Promise<string> {
    const cached = getCachedBlobText(meta.sha);
    if (cached !== undefined) return cached;
    const bytes = meta.inline ?? (await fetchRawBlob(this.token, this.owner, this.repo, meta.sha));
    const text = utf8Text(bytes);
    putCachedBlobText(meta.sha, text);
    return text;
  }

  async readText(path: string): Promise<string | null> {
    const meta = await this.fileMeta(path);
    return meta ? this.textOf(meta) : null;
  }

  async readTexts(paths: readonly string[]): Promise<Map<string, string | null>> {
    const wanted = unique(paths);
    await this.primeDirs(wanted);
    const result = new Map<string, string | null>();
    await mapWithConcurrency(wanted, READ_CONCURRENCY, async (path) => {
      result.set(path, await this.readText(path));
    });
    return result;
  }

  async readJson<T>(path: string): Promise<T | null> {
    const text = await this.readText(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** A JSON-array manifest; missing means empty, unparseable throws CorruptJsonError. */
  async readJsonArray<T>(path: string): Promise<T[]> {
    return parseJsonArray<T>(path, await this.readText(path));
  }

  /** Which of the given chunk hashes already have an objects/<prefix>/<hash> file. */
  async existingObjects(hashes: readonly string[]): Promise<Set<string>> {
    const byPrefix = new Map<string, Set<string>>();
    for (const hash of hashes) {
      const prefix = hash.slice(0, 2);
      let group = byPrefix.get(prefix);
      if (!group) byPrefix.set(prefix, (group = new Set()));
      group.add(hash);
    }
    const found = new Set<string>();
    const collect = (prefix: string, names: { has(name: string): boolean }) => {
      for (const hash of byPrefix.get(prefix) ?? []) if (names.has(hash)) found.add(hash);
    };

    let remaining = Array.from(byPrefix.keys());
    if (remaining.length <= DIRECT_PREFIX_LIMIT) {
      const overflow: string[] = [];
      await mapWithConcurrency(remaining, READ_CONCURRENCY, async (prefix) => {
        const names = await this.contentsDirNames(`objects/${prefix}`);
        if (names === "overflow") overflow.push(prefix);
        else collect(prefix, names);
      });
      remaining = overflow;
    }
    if (remaining.length === 0) return found;

    if (remaining.length > DIRECT_PREFIX_LIMIT) {
      const all = await this.allObjectNames();
      if (all) {
        for (const prefix of remaining) collect(prefix, all);
        return found;
      }
    }
    await mapWithConcurrency(remaining, READ_CONCURRENCY, async (prefix) => {
      const dir = await this.listDir(`objects/${prefix}`);
      if (dir) collect(prefix, { has: (name) => dir.get(name)?.type === "blob" });
    });
    return found;
  }

  private async contentsDirNames(path: string): Promise<Set<string> | "overflow"> {
    const data = await githubJsonOrNull<ContentFile | ContentFile[]>(
      this.token,
      this.path(`/contents/${encodePath(path)}?ref=${encodeURIComponent(this.ref)}`)
    );
    if (!data || !Array.isArray(data)) return new Set();
    if (data.length >= CONTENTS_DIR_LIMIT) return "overflow";
    return new Set(data.filter((entry) => entry.type === "file").map((entry) => entry.name));
  }

  /** Every object file name in one recursive listing, or null if GitHub truncated it. */
  private async allObjectNames(): Promise<Set<string> | null> {
    const objects = (await this.listDir(""))?.get("objects");
    if (!objects || objects.type !== "tree") return new Set();
    const data = await githubJson<TreeResponse>(
      this.token,
      this.path(`/git/trees/${encodeURIComponent(objects.sha)}?recursive=1`)
    );
    if (data.truncated) return null;
    const names = new Set<string>();
    for (const entry of data.tree) {
      if (entry.type === "blob" && entry.path) names.add(baseName(entry.path));
    }
    return names;
  }
}
