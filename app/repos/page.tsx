"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiJson, ApiError } from "@/lib/library/api";
import NavBar from "../components/NavBar";
import { useConfirm } from "../components/ui/ConfirmDialog";

interface RepoSummary {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

type Busy = { kind: "create" } | { kind: "use"; id: number } | null;

interface PageError {
  message: string;
  signedOut?: boolean;
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const FILTER_THRESHOLD = 6;

function describeError(err: unknown, action: "load" | "create" | "use"): PageError {
  if (err instanceof ApiError) {
    if (err.kind === "auth") {
      return { message: "You're signed out. Sign in with GitHub again to continue.", signedOut: true };
    }
    if (err.kind === "offline") return { message: "You're offline. Check your connection and try again." };
    if (err.kind === "rate-limit") return { message: err.message };
    if (action === "create" && (err.status === 422 || /already exists/i.test(err.message))) {
      return { message: "You already have a repo with that name. Pick another name, or choose it from the list below." };
    }
    if (err.status === 403) {
      return { message: "GitHub didn't allow that. Make sure 404GB has access to this repo." };
    }
    if (err.kind === "not-found" && action === "use") {
      return { message: "That repo couldn't be found. It may have been renamed or deleted." };
    }
  }
  if (action === "load") return { message: "Couldn't load your repos. Try again." };
  if (action === "create") return { message: "Couldn't create the repo. Try again." };
  return { message: "Couldn't set up that repo. Try again." };
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give your repo a name.";
  if (trimmed.length > 100) return "Use 100 characters or fewer.";
  if (!NAME_PATTERN.test(trimmed)) return "Use letters, numbers, dashes, dots or underscores.";
  if (trimmed === "." || trimmed === "..") return "That name isn't allowed.";
  return null;
}

function Spinner() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5Z" />
    </svg>
  );
}

export default function ReposPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<PageError | null>(null);
  const [actionError, setActionError] = useState<PageError | null>(null);
  const [newRepoName, setNewRepoName] = useState("404gb-data");
  const [nameTouched, setNameTouched] = useState(false);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    apiJson<{ repos: RepoSummary[] }>("/api/repos")
      .then((data) => {
        if (!cancelled) setRepos(data.repos ?? []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(describeError(err, "load"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const nameError = validateName(newRepoName);
  const visibleRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;
  }, [repos, filter]);

  async function initRepo(owner: string, repo: string, createNew: boolean, nextBusy: Busy) {
    setBusy(nextBusy);
    setActionError(null);
    try {
      await apiJson("/api/repos/init", { method: "POST", body: { owner, repo, createNew } });
      router.push("/gallery");
      router.refresh();
    } catch (err) {
      setActionError(describeError(err, createNew ? "create" : "use"));
      setBusy(null);
    }
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (nameError || busy) return;
    void initRepo("", newRepoName.trim(), true, { kind: "create" });
  }

  async function onUse(repo: RepoSummary) {
    if (busy) return;
    if (!repo.private) {
      const ok = await confirm({
        title: "Use a public repo?",
        message: "Anyone on the internet can see what's in a public repo, including your photos and videos.",
        confirmLabel: "Use anyway",
        destructive: true,
      });
      if (!ok) return;
    }
    void initRepo(repo.owner, repo.name, false, { kind: "use", id: repo.id });
  }

  const error = actionError ?? loadError;

  return (
    <>
      <NavBar />
      <main className="mx-auto flex w-full max-w-xl flex-col gap-6 p-4 pb-tabbar-safe pt-safe-4 sm:p-8">
        <header className="flex flex-col gap-2 animate-fade-in-up">
          <h1 className="text-h1 font-bold tracking-tight">Choose a storage repo</h1>
          <p className="text-body text-ink-muted">
            404GB keeps your photos and videos in a GitHub repository that you own. Create a new
            private one, or pick one you already have.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-small text-danger animate-fade-in"
          >
            <span>{error.message}</span>
            {error.signedOut ? (
              <Link href="/" className="font-semibold underline-offset-4 hover:underline">
                Sign in again
              </Link>
            ) : (
              loadError === error && (
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="font-semibold underline-offset-4 hover:underline"
                >
                  Try again
                </button>
              )
            )}
          </div>
        )}

        <form
          onSubmit={onCreate}
          noValidate
          className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-soft"
        >
          <h2 className="text-h3 font-semibold">Create a new repo</h2>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="repo-name" className="text-small font-medium text-ink">
              Repository name
            </label>
            <input
              id="repo-name"
              name="repo-name"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={newRepoName}
              onChange={(e) => setNewRepoName(e.target.value)}
              onBlur={() => setNameTouched(true)}
              aria-invalid={nameTouched && nameError ? true : undefined}
              aria-describedby="repo-name-hint"
              className={`h-12 rounded-xl border bg-surface-2 px-3.5 font-mono text-body text-ink outline-none transition-colors duration-180 focus:border-accent ${
                nameTouched && nameError ? "border-danger" : "border-border"
              }`}
            />
            <p
              id="repo-name-hint"
              className={`text-small ${nameTouched && nameError ? "text-danger" : "text-ink-muted"}`}
            >
              {nameTouched && nameError ? nameError : "Created as a private repo in your GitHub account."}
            </p>
          </div>
          <button
            type="submit"
            disabled={busy !== null}
            className="inline-flex h-11 items-center justify-center gap-2 self-start rounded-full bg-ink px-5 text-small font-semibold text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-60"
          >
            {busy?.kind === "create" && <Spinner />}
            {busy?.kind === "create" ? "Creating…" : "Create and continue"}
          </button>
        </form>

        <section aria-labelledby="existing-heading" className="flex flex-col gap-3">
          <div className="flex items-end justify-between gap-3">
            <h2 id="existing-heading" className="text-h3 font-semibold">
              Or use an existing repo
            </h2>
            {!loading && repos.length > 0 && (
              <span className="text-small text-ink-faint">{repos.length} repos</span>
            )}
          </div>

          {repos.length > FILTER_THRESHOLD && (
            <div className="relative">
              <label htmlFor="repo-filter" className="sr-only">
                Filter repos
              </label>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                id="repo-filter"
                type="search"
                placeholder="Filter repos"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-11 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-body text-ink outline-none transition-colors duration-180 placeholder:text-ink-faint focus:border-accent"
              />
            </div>
          )}

          {loading ? (
            <ul className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading repos">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="skeleton h-[60px] rounded-xl" />
              ))}
            </ul>
          ) : visibleRepos.length === 0 ? (
            !loadError && (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-body text-ink-muted">
                {repos.length === 0 ? "You don't have any repos yet. Create one above." : "No repos match that filter."}
              </p>
            )
          ) : (
            <ul className="flex flex-col gap-2.5">
              {visibleRepos.map((r) => {
                const usingThis = busy?.kind === "use" && busy.id === r.id;
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3 pl-4 transition-colors duration-180 hover:border-border-strong animate-fade-in"
                  >
                    <span className={r.private ? "text-ink-faint" : "text-warning"}>
                      {r.private ? <LockIcon /> : <GlobeIcon />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-small text-ink">{r.name}</span>
                      <span className="block truncate text-micro text-ink-faint">
                        {r.owner} · {r.private ? "Private" : "Public"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void onUse(r)}
                      aria-label={`Use ${r.fullName}`}
                      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border-strong px-4 text-small font-medium text-ink transition-colors duration-180 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {usingThis && <Spinner />}
                      {usingThis ? "Setting up…" : "Use"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
