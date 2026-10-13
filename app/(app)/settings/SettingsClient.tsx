"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import InstallPrompt from "@/app/components/InstallPrompt";
import { ThemeChoice } from "@/app/components/ThemeToggle";
import BackupSettings from "@/app/components/backup/BackupSettings";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import { buttonClass } from "@/app/components/ui/Button";
import BrandMark from "@/app/components/ui/BrandMark";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import DuplicateCleanup from "@/app/components/library/DuplicateCleanup";
import PeopleSettings from "@/app/components/people/PeopleSettings";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import {
  BentoGrid,
  BentoTile,
  BigNumber,
  IconTile,
  SettingsSection,
  cardClass,
} from "@/app/components/library/SettingsBlocks";
import {
  DownloadAppIcon,
  ExternalIcon,
  GithubIcon,
  LogoutIcon,
  MonitorIcon,
  TrashIcon,
} from "@/app/components/library/icons";
import { formatBytes } from "@/app/gallery/viewer/format";
import { getSyncState, repoKeyFor } from "@/lib/cache";
import { useBackupStatus, useLibrary } from "@/lib/library/hooks";
import { clearLocalLibraryData } from "@/lib/library/localData";
import { flushPendingDeletes } from "@/lib/library/mediaStore";
import { useRepoSize } from "@/lib/library/repoSize";
import { TRASH_RETENTION_DAYS } from "@/lib/library/trash";
import { flushFaces } from "@/lib/faces/store";
import { isNativeApp } from "@/lib/native/platform";
import { signOut } from "@/lib/session";

// Signing out waits this long at most for deletes still in their undo window to commit.
const FLUSH_TIMEOUT_MS = 8000;

interface SettingsClientProps {
  githubLogin: string | null;
  repoOwner: string | null;
  repoName: string | null;
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** The commit the library last synced to, as kept with this device's cache (lib/cache). */
function useLastCommit(repoKey: string | null, version: unknown): string | null {
  const [sha, setSha] = useState<{ repoKey: string; sha: string } | null>(null);
  useEffect(() => {
    if (!repoKey) return;
    let cancelled = false;
    void getSyncState(repoKey).then((state) => {
      if (!cancelled && state?.lastKnownSha) setSha({ repoKey, sha: state.lastKnownSha });
    });
    return () => {
      cancelled = true;
    };
  }, [repoKey, version]);
  return sha && sha.repoKey === repoKey ? sha.sha : null;
}

/** The repo card's size and facts line, from GitHub and the library. */
function RepoFacts({ owner, name }: { owner: string; name: string }) {
  const repoKey = repoKeyFor(owner, name);
  const library = useLibrary(repoKey);
  const reported = useRepoSize(owner, name);
  const lastCommit = useLastCommit(repoKey, library.syncing ? null : library.items);

  const { photos, videos, bytes } = useMemo(() => {
    let videoCount = 0;
    let total = 0;
    for (const item of library.items) {
      if (item.mimeType.startsWith("video/")) videoCount++;
      total += item.size ?? 0;
    }
    for (const item of library.trashed) total += item.size ?? 0;
    return { photos: library.items.length - videoCount, videos: videoCount, bytes: total };
  }, [library.items, library.trashed]);

  const loading = !library.synced && library.items.length === 0;
  // GitHub's number counts the whole repo (previews, history); until it answers, what the
  // library adds up to.
  const size = reported ?? (bytes > 0 || !loading ? bytes : null);
  const [value, unit] = formatBytes(size ?? 0).split(" ");

  return (
    <>
      <div className="mt-4 flex h-[46px] items-end">
        {size !== null ? (
          <BigNumber value={value} unit={unit} className="animate-fade-in text-[2.75rem]" />
        ) : (
          <span className="skeleton block h-10 w-36 rounded-tile" />
        )}
      </div>
      <div className="mt-3 flex min-h-[14px] items-center">
        {loading ? (
          <span className="skeleton block h-2.5 w-52 rounded-[3px]" />
        ) : (
          <Telemetry
            className="whitespace-normal"
            // A fact wraps to the next line whole: no breaks inside one, a break before each.
            items={[
              plural(photos, "photo", "photos"),
              plural(videos, "video", "videos"),
              lastCommit ? `Last commit ${lastCommit.slice(0, 7)}` : null,
            ].map((fact, i) =>
              fact ? (
                <Fragment key={i}>
                  {i > 0 && <wbr />}
                  <span className="whitespace-nowrap">{fact}</span>
                </Fragment>
              ) : null
            )}
          />
        )}
      </div>
    </>
  );
}

/**
 * Settings › the storage repo (docs/DESIGN.md › Screens › Settings): its size as GitHub
 * reports it (or what the library adds up to until GitHub says), what's in it, the commit
 * the library last synced to, and Change / Open on GitHub.
 */
function RepoCard({ owner, name }: { owner: string | null; name: string | null }) {
  const repo = owner && name ? `${owner}/${name}` : null;

  return (
    <section aria-label="Storage repo" className={`p-5 ${cardClass}`}>
      <div className="flex items-center gap-2">
        <GithubIcon size={14} className="shrink-0 text-ink-muted" />
        <Telemetry items={["Repo", repo ?? "None chosen"]} />
      </div>

      {owner && name ? (
        <RepoFacts owner={owner} name={name} />
      ) : (
        <p className="mt-3 text-small text-ink-muted">
          Choose the GitHub repository your photos and videos are stored in.
        </p>
      )}

      <div className="-mx-2 mt-4 flex flex-wrap items-center gap-1">
        <Link href="/repos" className={buttonClass({ variant: repo ? "ghost" : "primary", size: "sm" })}>
          {repo ? "Change" : "Choose"}
        </Link>
        {repo && (
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            Open on GitHub
            <ExternalIcon size={14} />
          </a>
        )}
      </div>
    </section>
  );
}

/** Settings › Library › Trash: how much is in it, and the way there. */
function TrashTile({ repoKey, wide }: { repoKey: string; wide: boolean }) {
  const library = useLibrary(repoKey);
  const count = library.trashed.length;
  return (
    <BentoTile
      icon={<TrashIcon size={18} />}
      title="Trash"
      value={count > 0 ? plural(count, "item", "items") : "Empty"}
      href="/albums/trash"
      className={wide ? "sm:col-span-2" : undefined}
    >
      <span className="mt-1 text-small text-ink-muted">
        Deleted photos and videos wait here for {TRASH_RETENTION_DAYS} days.
      </span>
    </BentoTile>
  );
}

export default function SettingsClient({ githubLogin, repoOwner, repoName }: SettingsClientProps) {
  const confirm = useConfirm();
  const backup = useBackupStatus();
  const [native, setNative] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const repo = repoOwner && repoName ? `${repoOwner}/${repoName}` : null;
  const repoKey = repoOwner && repoName ? repoKeyFor(repoOwner, repoName) : null;

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  async function handleSignOut() {
    const backupOn = backup.support === "available" && Boolean(backup.status?.enabled);
    const ok = await confirm({
      title: "Sign out of 404GB?",
      message: backupOn
        ? "Backup pauses until you sign in again. Everything already backed up stays in your repo."
        : "Your photos stay in your GitHub repo. This device forgets your token and its cached copy of your library.",
      confirmLabel: "Sign out",
      destructive: true,
    });
    if (!ok) return;
    setSigningOut(true);
    // Names and corrections not committed yet go first too.
    await Promise.race([
      Promise.all([flushPendingDeletes(), flushFaces()]),
      new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
    ]);
    await signOut();
    await clearLocalLibraryData();
    // A fresh start: every in-memory store of the previous session is gone with the page.
    window.location.replace("/");
  }

  const login = githubLogin ? `@${githubLogin}` : null;

  return (
    <ScrollArea scrollKey="settings">
      <PageHeader
        title="Settings"
        width="column"
        telemetry={
          login || repo ? (
            // An echo of the account row and repo card below, which carry the text for assistive
            // tech; the login is drawn by CSS so the page text has it once (the account row).
            <div aria-hidden="true">
              <Telemetry
                items={[login && <span data-login={login} className="before:content-[attr(data-login)]" />, repo]}
              />
            </div>
          ) : undefined
        }
      />
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 pb-6 pt-1 sm:px-6">
        <RepoCard owner={repoOwner} name={repoName} />

        <SettingsSection title="Backup">
          <BackupSettings />
        </SettingsSection>

        {repoKey && (
          <SettingsSection title="People">
            <PeopleSettings repoKey={repoKey} />
          </SettingsSection>
        )}

        <SettingsSection title="Library">
          <BentoGrid>
            {repoKey && <DuplicateCleanup repoKey={repoKey} />}
            {repoKey && <TrashTile repoKey={repoKey} wide={native !== false} />}
            {native === false && (
              <div
                className={`col-span-2 flex min-w-0 items-start gap-3.5 p-4 sm:col-span-1 sm:flex-col sm:gap-0 ${cardClass}`}
              >
                <IconTile tone="accent">
                  <DownloadAppIcon size={18} />
                </IconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:pt-4">
                  <p className="text-body font-medium text-ink">Install 404GB</p>
                  <p className="text-small text-ink-muted">
                    Opens from your home screen, full screen. No button here? Use your browser menu › Install app.
                  </p>
                  <div className="mt-2 empty:hidden">
                    <InstallPrompt />
                  </div>
                </div>
              </div>
            )}
            <div
              className={`col-span-2 flex min-w-0 flex-col gap-4 p-4 sm:col-span-3 sm:flex-row sm:items-center ${cardClass}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3.5">
                <IconTile>
                  <MonitorIcon size={18} />
                </IconTile>
                <div className="min-w-0">
                  <p className="text-body font-medium text-ink">Theme</p>
                  <p className="text-small text-ink-muted">Ink, paper, or whatever the system uses.</p>
                </div>
              </div>
              <ThemeChoice className="w-full sm:w-[22rem]" />
            </div>
          </BentoGrid>
        </SettingsSection>

        <SettingsSection title="Account">
          <div className={`flex min-h-[72px] items-center gap-3.5 px-4 py-3 ${cardClass}`}>
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-2/15 font-display text-h3 font-semibold uppercase text-accent-2"
            >
              {githubLogin ? githubLogin.charAt(0) : <GithubIcon size={18} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-body text-ink">{login ?? "Signed in"}</p>
              <p className="telemetry mt-1 truncate text-ink-muted">GitHub account</p>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className={buttonClass({ variant: "ghost", tone: "danger", size: "sm" })}
            >
              <LogoutIcon size={16} />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </SettingsSection>

        <footer className="flex flex-col items-center gap-3 pt-2">
          <BrandMark className="h-7 w-7" />
          <p className="telemetry text-center text-ink-muted">404GB · Your phone is full. Your repo isn&apos;t.</p>
        </footer>
      </div>
    </ScrollArea>
  );
}
