"use client";

// The storage repo's size as GitHub reports it (GET /repos/{owner}/{repo} → `size`, in KB),
// for the repo card in Settings. GitHub only recomputes it every so often, so it is asked at
// most once an hour per repo: the answer is kept in localStorage with when it was read, and
// a stale one is still shown while the new one loads (or when GitHub can't be reached).

import { useEffect, useState } from "react";
import { githubJson, repoPath } from "@/lib/github";
import { withToken } from "./api";

const STORAGE_KEY = "404gb-repo-size";
const MAX_AGE_MS = 60 * 60 * 1000;

interface SizeEntry {
  /** Bytes (GitHub's KB × 1024). */
  bytes: number;
  at: number;
}

const inflight = new Map<string, Promise<number | null>>();

function readAll(): Record<string, SizeEntry> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, SizeEntry>) : {};
  } catch {
    return {};
  }
}

function cached(repoKey: string): SizeEntry | null {
  const entry = readAll()[repoKey];
  return entry && typeof entry.bytes === "number" && typeof entry.at === "number" ? entry : null;
}

function remember(repoKey: string, bytes: number): void {
  try {
    const all = readAll();
    all[repoKey] = { bytes, at: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Only means asking GitHub again next time.
  }
}

/** Asks GitHub (one request per repo at a time). Null when it doesn't say, e.g. a brand-new
 * repo it hasn't measured yet. */
function fetchRepoSize(owner: string, repo: string, repoKey: string): Promise<number | null> {
  const running = inflight.get(repoKey);
  if (running) return running;
  const request = withToken((token) => githubJson<{ size?: unknown }>(token, repoPath(owner, repo)))
    .then((data) => {
      const kb = typeof data.size === "number" && Number.isFinite(data.size) ? data.size : 0;
      const bytes = kb > 0 ? kb * 1024 : null;
      if (bytes !== null) remember(repoKey, bytes);
      return bytes;
    })
    .finally(() => inflight.delete(repoKey));
  inflight.set(repoKey, request);
  return request;
}

/** The repo's size in bytes as GitHub last reported it, or null until (or unless) it's known. */
export function useRepoSize(owner: string | null, repo: string | null): number | null {
  const repoKey = owner && repo ? `${owner}/${repo}` : null;
  const [size, setSize] = useState<{ repoKey: string; bytes: number } | null>(null);

  useEffect(() => {
    if (!owner || !repo || !repoKey) return;
    let cancelled = false;
    const entry = cached(repoKey);
    if (entry) setSize({ repoKey, bytes: entry.bytes });
    if (entry && Date.now() - entry.at < MAX_AGE_MS) return;
    fetchRepoSize(owner, repo, repoKey).then(
      (bytes) => {
        if (!cancelled && bytes !== null) setSize({ repoKey, bytes });
      },
      () => {
        // Offline, signed out, rate limited: the card falls back to the library's own total.
      }
    );
    return () => {
      cancelled = true;
    };
  }, [owner, repo, repoKey]);

  return size && size.repoKey === repoKey ? size.bytes : null;
}
