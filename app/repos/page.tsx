"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

export default function ReposPage() {
  const router = useRouter();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newRepoName, setNewRepoName] = useState("404gb-data");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/repos")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "failed");
        return res.json();
      })
      .then((data) => setRepos(data.repos))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  async function initRepo(owner: string, repo: string, createNew: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/repos/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo, createNew }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "init failed");
      router.push("/gallery");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-4 pb-tabbar-safe sm:p-8">
      <h1 className="text-h1 font-bold tracking-tight">Choose a storage repo</h1>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-soft">
        <h2 className="text-h3 font-semibold">Create a new repo</h2>
        <input
          className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-body text-ink outline-none transition-colors duration-180 focus:border-accent"
          value={newRepoName}
          onChange={(e) => setNewRepoName(e.target.value)}
        />
        <button
          disabled={busy}
          onClick={() => initRepo("", newRepoName, true)}
          className="self-start rounded-full bg-ink px-4 py-2 text-small font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          Create &amp; initialize
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-semibold">Or use an existing repo</h2>
        {loading && <p className="text-body text-ink-muted">Loading repos…</p>}
        {error && <p className="text-body text-danger">{error}</p>}
        <ul className="flex flex-col gap-2.5">
          {repos.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3.5 transition-colors duration-180 hover:border-border-strong"
            >
              <span className="truncate font-mono text-small text-ink">{r.fullName}</span>
              <button
                disabled={busy}
                onClick={() => initRepo(r.owner, r.name, false)}
                className="shrink-0 rounded-full border border-border-strong px-3 py-1.5 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
              >
                Use this repo
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
