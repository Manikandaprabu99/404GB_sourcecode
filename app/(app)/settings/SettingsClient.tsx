"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import InstallPrompt from "@/app/components/InstallPrompt";
import ThemeToggle from "@/app/components/ThemeToggle";
import BackupSettings from "@/app/components/backup/BackupSettings";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
import DuplicateCleanup from "@/app/components/library/DuplicateCleanup";
import PageHeader from "@/app/components/library/PageHeader";
import ScrollArea from "@/app/components/library/ScrollArea";
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  rowButtonClass,
} from "@/app/components/library/SettingsBlocks";
import { DownloadAppIcon, ExternalIcon, GithubIcon, LogoutIcon } from "@/app/components/library/icons";
import { useBackupStatus } from "@/lib/library/hooks";
import { clearLocalLibraryData } from "@/lib/library/localData";
import { flushPendingDeletes } from "@/lib/library/mediaStore";
import { repoKeyFor } from "@/lib/cache";
import { isNativeApp } from "@/lib/native/platform";
import { signOut } from "@/lib/session";

// Signing out waits this long at most for deletes still in their undo window to commit.
const FLUSH_TIMEOUT_MS = 8000;

interface SettingsClientProps {
  githubLogin: string | null;
  repoOwner: string | null;
  repoName: string | null;
}

export default function SettingsClient({ githubLogin, repoOwner, repoName }: SettingsClientProps) {
  const confirm = useConfirm();
  const backup = useBackupStatus();
  const [native, setNative] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const repo = repoOwner && repoName ? `${repoOwner}/${repoName}` : null;

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
    await Promise.race([flushPendingDeletes(), new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS))]);
    await signOut();
    await clearLocalLibraryData();
    // A fresh start: every in-memory store of the previous session is gone with the page.
    window.location.replace("/");
  }

  return (
    <ScrollArea scrollKey="settings">
      <PageHeader title="Settings" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-4 pb-6 pt-2 sm:px-6">
        <SettingsSection title="Backup">
          <BackupSettings />
        </SettingsSection>

        <SettingsSection title="Appearance">
          <SettingsCard>
            <SettingsRow
              title="Theme"
              description="Switch between light and dark."
              trailing={<ThemeToggle />}
            />
          </SettingsCard>
        </SettingsSection>

        {native === false && (
          <SettingsSection title="Install app">
            <SettingsCard>
              <SettingsRow
                icon={<DownloadAppIcon size={18} />}
                title="Install 404GB"
                description="Open it from your home screen, full screen like an app. If there's no button, use your browser menu › Install app."
                trailing={<InstallPrompt />}
              />
            </SettingsCard>
          </SettingsSection>
        )}

        <SettingsSection title="Storage">
          <SettingsCard>
            <SettingsRow
              icon={<GithubIcon size={18} />}
              title={repo ? <span className="break-all font-mono text-small">{repo}</span> : "No repo selected"}
              description="Your photos and videos are stored in this GitHub repository."
              trailing={
                <Link href="/repos" className={rowButtonClass}>
                  {repo ? "Change" : "Choose"}
                </Link>
              }
            />
            {repo && (
              <a
                href={`https://github.com/${repo}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-3 text-small font-medium text-accent transition-colors duration-180 hover:bg-surface-2"
              >
                Open on GitHub
                <ExternalIcon size={16} />
              </a>
            )}
            {repoOwner && repoName && <DuplicateCleanup repoKey={repoKeyFor(repoOwner, repoName)} />}
          </SettingsCard>
        </SettingsSection>

        <SettingsSection title="Account">
          <SettingsCard>
            <SettingsRow
              icon={<GithubIcon size={18} />}
              title={githubLogin ? `@${githubLogin}` : "Signed in"}
              description="Signed in with GitHub"
              trailing={
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={signingOut}
                  className={`${rowButtonClass} text-danger`}
                >
                  <LogoutIcon size={16} />
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              }
            />
          </SettingsCard>
        </SettingsSection>

        <p className="px-1 text-center text-micro text-ink-faint">404GB · Your phone is full. Your repo isn&apos;t.</p>
      </div>
    </ScrollArea>
  );
}
