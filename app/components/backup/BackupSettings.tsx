"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { Backup, type BackupFolders, type BackupOptions, type BackupStatus } from "@/lib/native/backup";
import {
  applyBackupStatus,
  backupRunProgress,
  errorCode,
  errorMessage,
  describeWait,
  refreshBackupStatus,
  type BackupPillIcon,
  type BackupRun,
} from "@/lib/library/backupStore";
import { formatRelativeTime } from "@/lib/library/dates";
import { useBackupStatus } from "@/lib/library/hooks";
import { flushPendingDeletes } from "@/lib/library/mediaStore";
import { leaveForSignIn } from "@/lib/library/signedOut";
import { SettingsCard, rowButtonClass } from "@/app/components/library/SettingsBlocks";
import {
  AlertIcon,
  BatteryChargingIcon,
  BatteryLowIcon,
  ClockIcon,
  CloudCheckIcon,
  CloudOffIcon,
  DownloadAppIcon,
  LockIcon,
  RefreshIcon,
  SignalIcon,
  SyncIcon,
  UploadIcon,
  WifiIcon,
} from "@/app/components/library/icons";
import EnableBackupSheet from "./EnableBackupSheet";
import NetworkChoice from "./NetworkChoice";

const CHOICES_KEY = "404gb-backup-choices";
const PERMISSION_MESSAGE =
  "404GB needs access to your photos and videos to back them up. Allow it when Android asks, or open Settings › Apps › 404GB › Permissions and allow Photos and videos.";

type BusyAction = "toggle" | "options" | "now" | "retry" | "battery";

const FALLBACK_OPTIONS: BackupOptions = { includeExisting: true, folders: "all", wifiOnly: true, chargingOnly: false };

function readChoices(): Pick<BackupOptions, "includeExisting" | "folders"> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CHOICES_KEY) ?? "null");
    if (parsed && typeof parsed === "object") {
      const value = parsed as Partial<BackupOptions>;
      return {
        includeExisting: value.includeExisting !== false,
        folders: value.folders === "camera" ? "camera" : "all",
      };
    }
  } catch {
    // Fall through to the defaults.
  }
  return { includeExisting: true, folders: "all" };
}

function saveChoices(options: BackupOptions) {
  try {
    window.localStorage.setItem(
      CHOICES_KEY,
      JSON.stringify({ includeExisting: options.includeExisting, folders: options.folders })
    );
  } catch {
    // Only affects what the sheet suggests next time.
  }
}

function Callout({
  icon,
  tone,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  tone: "warn" | "danger" | "info";
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    warn: "border-warning/30 bg-warning/10 [&>span]:text-warning",
    danger: "border-danger/30 bg-danger/10 [&>span]:text-danger",
    info: "border-border bg-surface-2 [&>span]:text-ink-muted",
  };
  return (
    <div role={tone === "info" ? undefined : "alert"} className={`flex gap-3 rounded-xl border p-3.5 ${tones[tone]}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-small font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-small text-ink-muted">{children}</p>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <dt className="text-micro text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-h3 font-semibold tabular-nums ${danger ? "text-danger" : "text-ink"}`}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

// GitHub accepts roughly 500 new objects an hour per account and a photo takes
// about nine (its chunks, three previews, metadata and the commit itself).
const UPLOADS_PER_HOUR = 55;
const BACKLOG_NOTE_MIN = 60;

function backlogEstimate(pending: number): string {
  const hours = pending / UPLOADS_PER_HOUR;
  if (hours < 1) return "under an hour";
  if (hours < 1.5) return "about an hour";
  if (hours < 36) return `about ${Math.round(hours)} hours`;
  return `about ${Math.round(hours / 24)} days`;
}

function waitIcon(icon: BackupPillIcon): ReactNode {
  const className = "text-ink-muted";
  switch (icon) {
    case "charging":
      return <BatteryChargingIcon size={18} className={className} />;
    case "battery":
      return <BatteryLowIcon size={18} className="text-warning" />;
    case "signal":
      return <SignalIcon size={18} className={className} />;
    case "clock":
      return <ClockIcon size={18} className={className} />;
    case "off":
      return <CloudOffIcon size={18} className={className} />;
    default:
      return <WifiIcon size={18} className={className} />;
  }
}


function statusHeadline(status: BackupStatus, run: BackupRun | null): { icon: ReactNode; text: string } {
  switch (status.state) {
    case "uploading": {
      const { done, total } = backupRunProgress(status, run);
      return {
        icon: <SyncIcon size={18} className="animate-spin text-accent [animation-duration:2.4s]" />,
        text: total > 0 ? `Backing up ${Math.min(done + 1, total)} of ${total}` : "Backing up",
      };
    }
    case "scanning":
      return {
        icon: <SyncIcon size={18} className="animate-spin text-accent [animation-duration:2.4s]" />,
        text: "Checking for new photos and videos",
      };
    case "waiting": {
      const wait = describeWait(status);
      return { icon: waitIcon(wait.icon), text: wait.label };
    }
    case "needs_permission":
      return { icon: <AlertIcon size={18} className="text-warning" />, text: "Photo access needed" };
    case "needs_sign_in":
      return { icon: <LockIcon size={18} className="text-warning" />, text: "Signed out" };
    default:
      return status.pending > 0
        ? { icon: <UploadIcon size={18} className="text-ink-muted" />, text: `${status.pending} waiting to back up` }
        : { icon: <CloudCheckIcon size={18} className="text-success" />, text: "Everything is backed up" };
  }
}

/** Swaps this device's token for a new one: due deletes go first, then the sign-in screen opens. */
async function signInAgain() {
  await Promise.race([flushPendingDeletes(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  leaveForSignIn();
}

/** Backup section of Settings: on/off, options and live status of the phone's backup. */
export default function BackupSettings() {
  const toast = useToast();
  const backup = useBackupStatus();
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<{ permission: boolean; message: string } | null>(null);
  const [sheetDefaults, setSheetDefaults] = useState<BackupOptions | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function run<T>(action: BusyAction, task: () => Promise<T>): Promise<T | undefined> {
    setBusy(action);
    setError(null);
    try {
      return await task();
    } catch (err) {
      const permission = errorCode(err) === "PERMISSION_DENIED";
      setError({ permission, message: permission ? PERMISSION_MESSAGE : errorMessage(err) });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  if (backup.support === "unknown") {
    return (
      <SettingsCard>
        <div className="flex items-center gap-3.5 px-4 py-4">
          <span className="skeleton block h-9 w-9 rounded-full" />
          <span className="skeleton block h-4 w-48 rounded-full" />
        </div>
      </SettingsCard>
    );
  }

  if (backup.support === "browser") {
    return (
      <SettingsCard>
        <div className="flex gap-3.5 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <DownloadAppIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">Automatic backup needs the Android app</p>
            <p className="mt-1 text-small text-ink-muted">
              The 404GB app backs up new photos and videos from your phone by itself, in original quality. In a
              browser, add them from the Upload tab.
            </p>
            <Link href="/upload" className={`${rowButtonClass} mt-3`}>
              <UploadIcon size={16} />
              Go to Upload
            </Link>
          </div>
        </div>
      </SettingsCard>
    );
  }

  if (backup.support === "app-update-needed") {
    return (
      <SettingsCard>
        <div className="flex gap-3.5 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning">
            <DownloadAppIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-body font-medium text-ink">Update the app to turn on backup</p>
            <p className="mt-1 text-small text-ink-muted">
              This version of the 404GB app can&apos;t back up automatically. Install the latest version, then
              come back here to turn it on.
            </p>
          </div>
        </div>
      </SettingsCard>
    );
  }

  const status = backup.status;
  if (!status) {
    return (
      <SettingsCard>
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <p className="text-small text-ink-muted">
            {backup.error ? `Couldn't read backup status: ${backup.error}` : "Loading backup status…"}
          </p>
          {backup.error && (
            <button type="button" onClick={() => void refreshBackupStatus()} className={rowButtonClass}>
              Retry
            </button>
          )}
        </div>
      </SettingsCard>
    );
  }

  const enabled = status.enabled && status.state !== "off";
  const running = status.state === "uploading" || status.state === "scanning";
  const headline = statusHeadline(status, backup.run);
  const progress = status.state === "uploading" ? backupRunProgress(status, backup.run) : null;
  const currentPct =
    status.current && status.current.bytesTotal > 0
      ? Math.round((status.current.bytesDone / status.current.bytesTotal) * 100)
      : null;

  const openEnableSheet = () =>
    setSheetDefaults({ ...readChoices(), wifiOnly: status.wifiOnly, chargingOnly: status.chargingOnly });

  async function enable(options: BackupOptions) {
    saveChoices(options);
    const result = await run("toggle", () => Backup.enable(options));
    setSheetDefaults(null);
    if (result) applyBackupStatus(result);
  }

  function requestAccessAgain() {
    if (!status) return;
    void enable({
      ...readChoices(),
      wifiOnly: status.wifiOnly,
      chargingOnly: status.chargingOnly,
      folders: status.folders,
    });
  }

  function setOption(patch: Partial<Pick<BackupOptions, "wifiOnly" | "chargingOnly" | "folders">>) {
    void run("options", async () => applyBackupStatus(await Backup.setOptions(patch)));
  }

  return (
    <div className="flex flex-col gap-3">
      <SettingsCard>
        <div className="px-4 py-3.5">
          <Switch
            checked={enabled}
            onChange={(checked) => {
              if (checked) openEnableSheet();
              else void run("toggle", async () => applyBackupStatus(await Backup.disable()));
            }}
            label="Back up photos & videos"
            description={
              enabled
                ? "On. New photos and videos upload automatically."
                : "Off. New photos and videos on this phone aren't backed up."
            }
            disabled={busy !== null}
          />
        </div>

        {error && (
          <div className="px-4 py-3.5">
            <Callout
              icon={<AlertIcon size={18} />}
              tone="danger"
              title={error.permission ? "Photo access was denied" : "Something went wrong"}
              action={
                error.permission ? (
                  <button type="button" onClick={requestAccessAgain} className={rowButtonClass}>
                    Try again
                  </button>
                ) : undefined
              }
            >
              {error.message}
            </Callout>
          </div>
        )}

        {enabled && (
          <div className="flex flex-col gap-4 px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">{headline.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-ink">{headline.text}</p>
                <p className="text-small text-ink-muted">
                  {status.state === "waiting"
                    ? describeWait(status, now).detail
                    : status.lastBackupAt
                      ? `Last backup ${formatRelativeTime(status.lastBackupAt, now)}`
                      : "Nothing backed up from this phone yet"}
                </p>
                {progress && (
                  <div className="mt-2.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-320 ease-out-expo"
                        style={{ width: `${Math.max(2, progress.fraction * 100)}%` }}
                      />
                    </div>
                    {status.current && (
                      <p className="mt-1.5 truncate text-micro text-ink-faint">
                        {status.current.name}
                        {currentPct !== null ? ` · ${currentPct}%` : ""}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {status.pending >= BACKLOG_NOTE_MIN &&
              (status.state === "uploading" || status.state === "waiting" || status.state === "scanning") && (
                <Callout icon={<ClockIcon size={18} />} tone="info" title={`${status.pending.toLocaleString()} to go`}>
                  Your photos and videos are backed up newest first. GitHub takes roughly {UPLOADS_PER_HOUR} uploads an
                  hour, so this takes {backlogEstimate(status.pending)}. It carries on in the background by itself;
                  you don&apos;t need to keep the app open.
                </Callout>
              )}

            {status.state === "needs_permission" && (
              <Callout
                icon={<AlertIcon size={18} />}
                tone="warn"
                title="404GB can't see your photos"
                action={
                  <button
                    type="button"
                    onClick={requestAccessAgain}
                    disabled={busy !== null}
                    className={rowButtonClass}
                  >
                    Allow access
                  </button>
                }
              >
                Allow access to all photos and videos so new ones can be backed up.
              </Callout>
            )}

            {status.state === "needs_sign_in" && (
              <Callout
                icon={<LockIcon size={18} />}
                tone="warn"
                title="Sign in to keep backing up"
                action={
                  <button type="button" onClick={() => void signInAgain()} className={rowButtonClass}>
                    Sign in again
                  </button>
                }
              >
                Your GitHub sign-in expired, so backup is paused. Nothing is lost; it picks up where it left off.
              </Callout>
            )}

            {status.batteryOptimized && (
              <Callout
                icon={<BatteryChargingIcon size={18} />}
                tone="info"
                title="Let backup run in the background"
                action={
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void run("battery", () => Backup.openBatterySettings())}
                    className={rowButtonClass}
                  >
                    Allow background activity
                  </button>
                }
              >
                Backup only wakes up when there&apos;s something new and pauses when the battery is low, so this
                won&apos;t drain it. Without it, Android may hold backups back for hours when you don&apos;t open the
                app.
              </Callout>
            )}

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
              <Stat label="Backed up" value={status.uploaded} />
              <Stat label="Waiting" value={status.pending} />
              <Stat label="Already in library" value={status.skippedDuplicates} />
              <Stat label="Failed" value={status.failed} danger={status.failed > 0} />
            </dl>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null || running}
                onClick={() =>
                  void run("now", async () => {
                    await Backup.backupNow();
                    await refreshBackupStatus();
                  })
                }
                className={rowButtonClass}
              >
                <SyncIcon size={16} className={running ? "animate-spin [animation-duration:2.4s]" : ""} />
                {running ? "Backing up…" : "Back up now"}
              </button>
              {status.failed > 0 && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    void run("retry", async () => {
                      await Backup.retryFailed();
                      toast({
                        message: status.failed === 1 ? "Retrying 1 item" : `Retrying ${status.failed} items`,
                      });
                      await refreshBackupStatus();
                    })
                  }
                  className={rowButtonClass}
                >
                  <RefreshIcon size={16} />
                  Retry failed
                </button>
              )}
            </div>
          </div>
        )}
      </SettingsCard>

      {enabled && (
        <SettingsCard>
          <div className="px-4 py-3.5">
            <p className="text-body font-medium text-ink">Back up using</p>
            <p className="text-small text-ink-muted">
              {status.wifiOnly
                ? "Mobile data is never used. Backups wait for Wi-Fi."
                : "Uses mobile data when there's no Wi-Fi, but never while roaming."}
            </p>
            <NetworkChoice
              className="mt-2.5"
              wifiOnly={status.wifiOnly}
              disabled={busy !== null}
              onChange={(wifiOnly) => setOption({ wifiOnly })}
            />
          </div>
          <div className="px-4 py-3.5">
            <Switch
              checked={status.chargingOnly}
              onChange={(checked) => setOption({ chargingOnly: checked })}
              label="Only while charging"
              description="Backup always pauses on low battery. Turn this on to back up only while plugged in."
              disabled={busy !== null}
            />
          </div>
          <div className="px-4 py-3.5">
            <p className="text-body font-medium text-ink">Folders</p>
            <p className="text-small text-ink-muted">Which folders on this phone are backed up.</p>
            <div role="radiogroup" aria-label="Folders" className="mt-2.5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
              {(
                [
                  { value: "all", label: "All folders" },
                  { value: "camera", label: "Camera only" },
                ] as { value: BackupFolders; label: string }[]
              ).map(({ value, label }) => {
                const active = status.folders === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={busy !== null}
                    onClick={() => !active && setOption({ folders: value })}
                    className={`rounded-lg px-3 py-2 text-small font-medium transition-all duration-180 ease-out-expo disabled:opacity-60 ${
                      active ? "bg-surface text-ink shadow-soft" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </SettingsCard>
      )}

      {!enabled && !error && (
        <p className="flex items-start gap-2 px-1 text-small text-ink-muted">
          <CloudOffIcon size={16} className="mt-0.5 shrink-0" />
          Turn on backup to upload photos and videos from this phone automatically, even when the app is closed.
        </p>
      )}

      <EnableBackupSheet
        open={sheetDefaults !== null}
        defaults={sheetDefaults ?? FALLBACK_OPTIONS}
        busy={busy === "toggle"}
        onConfirm={(options) => void enable(options)}
        onClose={() => setSheetDefaults(null)}
      />
    </div>
  );
}
