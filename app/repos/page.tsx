"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRepo, getDefaultBranch, initRepoStructure, listRepos, type RepoSummary } from "@/lib/github";
import { ApiError, withToken } from "@/lib/library/api";
import { clearLocalLibraryData } from "@/lib/library/localData";
import { leaveForSignIn } from "@/lib/library/signedOut";
import { selectRepo, signOut } from "@/lib/session";
import NavBar from "../components/NavBar";
import { useRequiredSession } from "../components/useRequiredSession";
import { cardClass } from "../components/library/SettingsBlocks";
import { PlusIcon } from "../components/library/icons";
import { buttonClass } from "../components/ui/Button";
import { useConfirm } from "../components/ui/ConfirmDialog";
import StatusBadge from "../components/ui/StatusBadge";

type Busy = { kind: "create" } | { kind: "use"; id: number } | null;

interface PageError {
  message: string;
  signedOut?: boolean;
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

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
  const session = useRequiredSession(false);
  if (!session?.token) return null;
  return <RepoPicker login={session.login} currentRepo={session.owner && session.repo ? `${session.owner}/${session.repo}` : null} />;
}

function RepoPicker({ login, currentRepo }: { login: string | null; currentRepo: string | null }) {
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
    withToken((token) => listRepos(token))
      .then((list) => {
        if (!cancelled) setRepos(list);
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

  /** Creates the repo when asked, makes sure the manifest files exist, then makes it the library. */
  async function initRepo(target: { owner: string; repo: string; branch?: string }, createNew: boolean, nextBusy: Busy) {
    setBusy(nextBusy);
    setActionError(null);
    try {
      await withToken(async (token) => {
        let { owner, repo, branch } = target;
        if (createNew) {
          const created = await createRepo(token, repo);
          owner = created.owner;
          repo = created.name;
          branch = created.defaultBranch;
        }
        await initRepoStructure(token, owner, repo);
        await selectRepo(owner, repo, branch || (await getDefaultBranch(token, owner, repo)));
      });
      router.push("/gallery");
    } catch (err) {
      setActionError(describeError(err, createNew ? "create" : "use"));
      setBusy(null);
    }
  }

  function onCreate(event: FormEvent) {
    event.preventDefault();
    setNameTouched(true);
    if (nameError || busy) return;
    void initRepo({ owner: "", repo: newRepoName.trim() }, true, { kind: "create" });
  }

  async function onSwitchAccount() {
    const ok = await confirm({
      title: "Sign out of GitHub?",
      message: "You can sign in again with another account or token.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    await signOut();
    await clearLocalLibraryData();
    window.location.replace("/");
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
    void initRepo({ owner: repo.owner, repo: repo.name, branch: repo.defaultBranch }, false, { kind: "use", id: repo.id });
  }

  const error = actionError ?? loadError;

  return (
    <>
      <div className="fixed inset-0 flex flex-col bg-bg pl-safe pr-safe sm:flex-row">
      <NavBar />
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div aria-hidden="true" className="aurora pointer-events-none absolute inset-x-0 top-0 h-[380px]" />
      <main className="relative mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pb-tabbar-safe pt-safe-8 sm:px-6 sm:pb-12 sm:pt-12">
        <header className="flex flex-col gap-3 animate-fade-in-up">
          <h1 className="text-large-title text-ink lg:text-large-title-desktop">Choose a storage repo</h1>
          <p className="text-body text-ink-muted">
            404GB keeps your photos and videos in a GitHub repository that you own. Create a new
            private one, or pick one you already have.
          </p>
          {login && (
            <p className="flex flex-wrap items-center gap-x-2 text-footnote text-ink-muted">
              <span>
                Signed in as <span className="font-semibold text-ink">@{login}</span>
              </span>
              <span aria-hidden className="text-ink-faint">
                ·
              </span>
              <button
                type="button"
                onClick={() => void onSwitchAccount()}
                className={`${buttonClass({ variant: "ghost", size: "sm" })} -ml-2 !text-accent-text`}
              >
                Use another account
              </button>
            </p>
          )}
        </header>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-danger/10 py-2.5 pl-4 pr-2.5 text-callout font-normal text-ink animate-fade-in dark:text-danger"
          >
            <span className="min-w-0 flex-1">{error.message}</span>
            {error.signedOut ? (
              <button type="button" onClick={() => leaveForSignIn()} className={buttonClass({ variant: "secondary", size: "sm" })}>
                Sign in again
              </button>
            ) : (
              loadError === error && (
                <button
                  type="button"
                  onClick={() => setReloadKey((k) => k + 1)}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  Try again
                </button>
              )
            )}
          </div>
        )}


        <section aria-labelledby="existing-heading" className="flex flex-col gap-3.5">
          <div className="flex items-end justify-between gap-3 px-1">
            <h2 id="existing-heading" className="text-title text-ink">
              Your repos
            </h2>
            {!loading && repos.length > 0 && (
              <span className="shrink-0 pb-0.5 text-footnote tabular-nums text-ink-muted">{repos.length} repos</span>
            )}
          </div>

          {repos.length > 0 && (
            <div className="relative">
              <label htmlFor="repo-filter" className="sr-only">
                Filter repos
              </label>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.2-3.2" />
              </svg>
              <input
                id="repo-filter"
                type="search"
                placeholder="Filter repos"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="h-[46px] w-full rounded-full bg-surface-2 pl-11 pr-4 text-body text-ink placeholder:text-ink-faint dark:bg-ink/[0.07]"
              />
            </div>
          )}

          {loading ? (
            <ul className={`settings-card overflow-hidden ${cardClass}`} aria-busy="true" aria-label="Loading repos">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="flex min-h-[64px] items-center gap-3.5 px-4">
                  <span className="skeleton h-[30px] w-[30px] shrink-0 rounded-[8px]" />
                  <span className="flex flex-1 flex-col gap-2">
                    <span className="skeleton block h-3.5 w-32 rounded-full" />
                    <span className="skeleton block h-3 w-20 rounded-full" />
                  </span>
                </li>
              ))}
            </ul>
          ) : visibleRepos.length === 0 ? (
            !loadError && (
              <p className={`px-4 py-8 text-center text-body text-ink-muted ${cardClass}`}>
                {repos.length === 0 ? "You don't have any repos yet. Create one above." : "No repos match that filter."}
              </p>
            )
          ) : (
            <ul className={`settings-card overflow-hidden ${cardClass}`}>
              {visibleRepos.map((r) => {
                const usingThis = busy?.kind === "use" && busy.id === r.id;
                const current = r.fullName.toLowerCase() === currentRepo?.toLowerCase();
                return (
                  <li key={r.id} className="flex min-h-[64px] items-center gap-3.5 px-4 py-3 animate-fade-in">
                    <span
                      aria-hidden="true"
                      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white [&_svg]:h-4 [&_svg]:w-4 ${
                        r.private ? "bg-[rgb(142_148_160)]" : "bg-[rgb(245_158_11)]"
                      }`}
                    >
                      {r.private ? <LockIcon /> : <GlobeIcon />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="block min-w-0 truncate font-mono text-[15px] font-medium text-ink">{r.name}</span>
                        {current && (
                          <StatusBadge tone="live" glyph="done" className="shrink-0">
                            In use
                          </StatusBadge>
                        )}
                      </span>
                      <span className="truncate text-footnote text-ink-muted">
                        {r.owner} · {r.private ? "Private" : "Public"}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => (current ? router.push("/gallery") : void onUse(r))}
                      aria-label={current ? `Open ${r.fullName}` : `Use ${r.fullName}`}
                      className={buttonClass({ variant: current ? "primary" : "secondary", size: "sm" })}
                    >
                      {usingThis && <Spinner />}
                      {usingThis ? "Setting up…" : current ? "Open" : "Use"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <form onSubmit={onCreate} noValidate className={`flex flex-col gap-4 p-5 ${cardClass}`}>
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-glow-signal">
              <PlusIcon size={18} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h2 className="text-headline text-ink">Create a new library</h2>
              <p className="text-footnote text-ink-muted">A fresh private repo for your photos.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="repo-name" className="text-footnote font-semibold text-ink-muted">
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
              className={`h-12 rounded-control border bg-surface-2 px-3.5 font-mono text-body text-ink transition-colors duration-180 ${
                nameTouched && nameError ? "border-danger" : "border-transparent"
              }`}
            />
            <p
              id="repo-name-hint"
              className={`text-footnote ${nameTouched && nameError ? "text-danger" : "text-ink-muted"}`}
            >
              {nameTouched && nameError ? nameError : "Created as a private repo in your GitHub account."}
            </p>
          </div>
          <button type="submit" disabled={busy !== null} className={`${buttonClass({ variant: "primary" })} self-start`}>
            {busy?.kind === "create" && <Spinner />}
            {busy?.kind === "create" ? "Creating…" : "Create and continue"}
          </button>
        </form>
      </main>
      </div>
      </div>
    </>
  );
}
