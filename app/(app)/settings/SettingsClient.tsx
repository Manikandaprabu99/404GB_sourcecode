"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import InstallPrompt from "@/app/components/InstallPrompt";
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
  SettingsCard,
  SettingsRow,
  SettingsSection,
  cardClass,
} from "@/app/components/library/SettingsBlocks";
import { DownloadAppIcon, ExternalIcon, GithubIcon, LogoutIcon, TrashIcon } from "@/app/components/library/icons";
import { formatRelativeTime } from "@/lib/library/dates";
import AppearanceSettings from "./AppearanceSettings";
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
function RepoFacts({ owner, name, lastBackupAt }: { owner: string; name: string; lastBackupAt: number | null }) {
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
  // GitHub's number counts the whole repo; until it answers, what the library adds up to.
  const size = reported ?? (bytes > 0 || !loading ? bytes : null);
  const [value, unit] = formatBytes(size ?? 0).split(" ");

  return (
    <div className="mt-5 flex flex-col gap-2">
      <div className="flex h-[42px] items-end">
        {size !== null ? (
          <BigNumber value={value} unit={unit} className="animate-fade-in text-[2.5rem]" />
        ) : (
          <span className="skeleton block h-10 w-36 rounded-control" />
        )}
      </div>
      <div className="flex min-h-[18px] items-center">
        {loading ? (
          <span className="skeleton block h-3 w-52 rounded-full" />
        ) : (
          <Telemetry
            className="whitespace-normal"
            // Each fact wraps whole.
            items={[
              plural(photos, "photo", "photos"),
              plural(videos, "video", "videos"),
              lastBackupAt ? `Last backup ${formatRelativeTime(lastBackupAt)}` : null,
              lastCommit ? (
                <>
                  Commit <span className="font-mono text-[12px]">{lastCommit.slice(0, 7)}</span>
                </>
              ) : null,
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
    </div>
  );
}

/** The account and storage repo card at the top of Settings. */
function AccountCard({
  login,
  owner,
  name,
  lastBackupAt,
}: {
  login: string | null;
  owner: string | null;
  name: string | null;
  lastBackupAt: number | null;
}) {
  const repo = owner && name ? `${owner}/${name}` : null;

  return (
    <section aria-label="Storage repo" className={`relative overflow-hidden p-5 ${cardClass}`}>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-title font-bold uppercase text-white shadow-glow-signal"
        >
          {login ? login.charAt(1) : <GithubIcon size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-headline text-ink">{login ?? "Signed in"}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-footnote text-ink-muted">
            <GithubIcon size={13} className="shrink-0" />
            <span className="truncate">{repo ?? "No repo chosen"}</span>
          </p>
        </div>
      </div>

      {owner && name ? (
        <RepoFacts owner={owner} name={name} lastBackupAt={lastBackupAt} />
      ) : (
        <p className="mt-4 text-callout font-normal text-ink-muted">
          Choose the GitHub repository your photos and videos are stored in.
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href="/repos" className={buttonClass({ variant: repo ? "secondary" : "primary", size: "sm" })}>
          {repo ? "Change" : "Choose"}
        </Link>
        {repo && (
          <a
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass({ variant: "tertiary", size: "sm" })}
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
      iconTone="danger"
      title="Trash"
      value={count > 0 ? plural(count, "item", "items") : "Empty"}
      href="/albums/trash"
      className={wide ? "sm:col-span-2" : undefined}
    >
      <span className="mt-1 text-footnote text-ink-muted">
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

  const lastBackupAt = backup.status?.lastBackupAt ?? null;

  return (
    <ScrollArea scrollKey="settings">
      <div aria-hidden="true" className="aurora pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <PageHeader title="Settings" width="column" />
      <div className="relative mx-auto flex w-full max-w-[720px] flex-col gap-7 px-4 pb-6 pt-2 sm:px-6 lg:px-8">
        <AccountCard login={login} owner={repoOwner} name={repoName} lastBackupAt={lastBackupAt} />

        <SettingsSection title="Backup">
          <BackupSettings />
        </SettingsSection>

        {repoKey && (
          <SettingsSection title="People">
            <PeopleSettings repoKey={repoKey} />
          </SettingsSection>
        )}

        <SettingsSection title="Appearance">
          <AppearanceSettings />
        </SettingsSection>

        <SettingsSection title="Library">
          <BentoGrid>
            {repoKey && <DuplicateCleanup repoKey={repoKey} />}
            {repoKey && <TrashTile repoKey={repoKey} wide={native !== false} />}
            {native === false && (
              <div className={`col-span-2 flex min-w-0 items-start gap-3.5 p-4 sm:col-span-1 sm:flex-col sm:gap-0 ${cardClass}`}>
                <IconTile tone="accent">
                  <DownloadAppIcon size={18} />
                </IconTile>
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:pt-4">
                  <p className="text-body font-semibold text-ink">Install 404GB</p>
                  <p className="text-footnote text-ink-muted">
                    Opens from your home screen, full screen. No button here? Use your browser menu › Install app.
                  </p>
                  <div className="mt-2 empty:hidden">
                    <InstallPrompt />
                  </div>
                </div>
              </div>
            )}
          </BentoGrid>
        </SettingsSection>

        <SettingsSection title="About">
          <SettingsCard>
            <SettingsRow
              icon={<BrandMark bare className="h-[18px] w-[18px]" />}
              iconTone="accent"
              title="404GB"
              description="Your phone is full. Your repo isn't."
            />
          </SettingsCard>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={`pressable mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 text-body font-semibold text-danger disabled:opacity-60 ${cardClass}`}
          >
            <LogoutIcon size={18} />
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </SettingsSection>
      </div>
    </ScrollArea>
  );
}
