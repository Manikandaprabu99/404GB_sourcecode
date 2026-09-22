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
    <main className="mx-auto flex max-w-xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-bold">Choose a storage repo</h1>

      <section className="flex flex-col gap-2 rounded border border-neutral-800 p-4">
        <h2 className="font-semibold">Create a new repo</h2>
        <input
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1"
          value={newRepoName}
          onChange={(e) => setNewRepoName(e.target.value)}
        />
        <button
          disabled={busy}
          onClick={() => initRepo("", newRepoName, true)}
          className="rounded bg-neutral-100 px-3 py-1.5 text-neutral-900 disabled:opacity-50"
        >
          Create &amp; initialize
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Or use an existing repo</h2>
        {loading && <p className="text-neutral-500">Loading repos…</p>}
        {error && <p className="text-red-400">{error}</p>}
        <ul className="flex flex-col gap-2">
          {repos.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded border border-neutral-800 p-3"
            >
              <span>{r.fullName}</span>
              <button
                disabled={busy}
                onClick={() => initRepo(r.owner, r.name, false)}
                className="rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-900 disabled:opacity-50"
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
