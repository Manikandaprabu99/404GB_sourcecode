"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import InstallPrompt from "@/app/components/InstallPrompt";
import ThemeToggle from "@/app/components/ThemeToggle";
import BackupSettings from "@/app/components/backup/BackupSettings";
import { useConfirm } from "@/app/components/ui/ConfirmDialog";
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
import { isNativeApp } from "@/lib/native/platform";

interface SettingsClientProps {
  githubLogin: string | null;
  repoOwner: string | null;
  repoName: string | null;
}

export default function SettingsClient({ githubLogin, repoOwner, repoName }: SettingsClientProps) {
  const confirm = useConfirm();
  const backup = useBackupStatus();
  const [native, setNative] = useState<boolean | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const repo = repoOwner && repoName ? `${repoOwner}/${repoName}` : null;

  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  async function logout() {
    const backupOn = backup.support === "available" && Boolean(backup.status?.enabled);
    const ok = await confirm({
      title: "Log out of 404GB?",
      message: backupOn
        ? "Backup pauses until you sign in again. Everything already backed up stays in your repo."
        : "Your photos stay in your GitHub repo. This device's cached copy of your library is removed.",
      confirmLabel: "Log out",
      destructive: true,
    });
    if (!ok) return;
    setLoggingOut(true);
    flushPendingDeletes();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Going home still shows the signed-out state once the cookie is gone.
    }
    await clearLocalLibraryData();
    window.location.assign("/");
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
                  onClick={() => void logout()}
                  disabled={loggingOut}
                  className={`${rowButtonClass} text-danger`}
                >
                  <LogoutIcon size={16} />
                  {loggingOut ? "Logging out…" : "Log out"}
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
