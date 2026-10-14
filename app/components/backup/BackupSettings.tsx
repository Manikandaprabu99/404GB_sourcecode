"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Switch from "@/app/components/ui/Switch";
import SegmentedControl from "@/app/components/ui/SegmentedControl";
import StatusBadge from "@/app/components/ui/StatusBadge";
import TileMeter from "@/app/components/ui/TileMeter";
import { useToast } from "@/app/components/ui/Toast";
import { Backup, type BackupFolders, type BackupOptions, type BackupStatus } from "@/lib/native/backup";
import {
  applyBackupStatus,
  backupRunProgress,
  describeBackup,
  errorCode,
  errorMessage,
  describeWait,
  refreshBackupStatus,
  type BackupRun,
} from "@/lib/library/backupStore";
import { formatRelativeTime } from "@/lib/library/dates";
import { useBackupStatus } from "@/lib/library/hooks";
import { flushPendingDeletes } from "@/lib/library/mediaStore";
import { leaveForSignIn } from "@/lib/library/signedOut";
import { IconTile, Stat, StatGrid, cardClass, rowButtonClass } from "@/app/components/library/SettingsBlocks";
import {
  AlertIcon,
  BatteryChargingIcon,
  ClockIcon,
  CloudOffIcon,
  DownloadAppIcon,
  LockIcon,
  RefreshIcon,
  SyncIcon,
  UploadIcon,
} from "@/app/components/library/icons";
import { StatusPill, shortLabel } from "./BackupStatusPill";
import EnableBackupSheet from "./EnableBackupSheet";
import NetworkChoice from "./NetworkChoice";

const CHOICES_KEY = "404gb-backup-choices";
const PERMISSION_MESSAGE =
  "404GB needs access to your photos and videos to back them up. Allow it when Android asks, or open Settings › Apps › 404GB › Permissions and allow Photos and videos.";

type BusyAction = "toggle" | "options" | "now" | "retry" | "battery";

const FALLBACK_OPTIONS: BackupOptions = { includeExisting: true, folders: "all", wifiOnly: true, chargingOnly: false };

const FOLDER_OPTIONS: { value: BackupFolders; label: string }[] = [
  { value: "all", label: "All folders" },
  { value: "camera", label: "Camera only" },
];

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

/** A tinted note inside the card: something to know (info) or to do (warn, danger). */
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
  const box = { warn: "bg-warning/10", danger: "bg-danger/10", info: "bg-surface-2 dark:bg-ink/[0.05]" }[tone];
  const iconTone = {
    warn: "bg-warning/15 text-warning",
    danger: "bg-danger/15 text-danger",
    info: "bg-accent-soft text-accent-text",
  }[tone];
  return (
    <div role={tone === "info" ? undefined : "alert"} className={`flex gap-3 rounded-control p-3.5 ${box}`}>
      <span aria-hidden="true" className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-callout font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-footnote text-ink-muted">{children}</p>
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}

/** A labelled control block inside the card: title, a line of explanation, the control. */
function Option({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 px-4 py-4">
      <div>
        <p className="text-body font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-footnote text-ink-muted">{description}</p>
      </div>
      {children}
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

/** The sentence next to the status badge. */
function statusHeadline(status: BackupStatus, run: BackupRun | null): string {
  switch (status.state) {
    case "uploading": {
      const { done, total } = backupRunProgress(status, run);
      return total > 0 ? `Backing up ${Math.min(done + 1, total)} of ${total}` : "Backing up";
    }
    case "scanning":
      return "Checking for new photos and videos";
    case "waiting":
      return describeWait(status).label;
    case "needs_permission":
      return "Photo access needed";
    case "needs_sign_in":
      return "Signed out";
    default:
      return status.pending > 0 ? `${status.pending} waiting to back up` : "Everything is backed up";
  }
}

/** Swaps this device's token for a new one: due deletes go first, then the sign-in screen opens. */
async function signInAgain() {
  await Promise.race([flushPendingDeletes(), new Promise((resolve) => setTimeout(resolve, 8000))]);
  leaveForSignIn();
}

/** A card with an icon tile, a badge, a title and an explanation (backup isn't available here). */
function InfoCard({
  icon,
  tone,
  badge,
  title,
  children,
}: {
  icon: ReactNode;
  tone: "accent" | "warning";
  badge: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex gap-3.5 p-4 ${cardClass}`}>
      <IconTile tone={tone} className="mt-0.5">
        {icon}
      </IconTile>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <StatusBadge tone={tone === "warning" ? "attention" : "neutral"} glyph="waiting">
          {badge}
        </StatusBadge>
        <p className="mt-2.5 text-body font-medium text-ink">{title}</p>
        {children}
      </div>
    </div>
  );
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
      <div aria-busy="true" className={`flex flex-col gap-3 p-4 ${cardClass}`}>
        <span className="skeleton block h-4 w-48 rounded-full" />
        <span className="skeleton block h-3 w-64 max-w-full rounded-full" />
      </div>
    );
  }

  if (backup.support === "browser") {
    return (
      <InfoCard
        icon={<DownloadAppIcon size={18} />}
        tone="accent"
        badge="Android app only"
        title="Automatic backup needs the Android app"
      >
        <p className="mt-1 text-small text-ink-muted">
          The 404GB app backs up new photos and videos from your phone by itself, in original quality. In a browser,
          add them from the Upload tab.
        </p>
        <Link href="/upload" className={`${rowButtonClass} mt-3`}>
          <UploadIcon size={16} />
          Go to Upload
        </Link>
      </InfoCard>
    );
  }

  if (backup.support === "app-update-needed") {
    return (
      <InfoCard icon={<DownloadAppIcon size={18} />} tone="warning" badge="Update app" title="Update the app to turn on backup">
        <p className="mt-1 text-small text-ink-muted">
          This version of the 404GB app can&apos;t back up automatically. Install the latest version, then come back
          here to turn it on.
        </p>
      </InfoCard>
    );
  }

  const status = backup.status;
  if (!status) {
    return (
      <div className={`flex items-center justify-between gap-3 px-4 py-4 ${cardClass}`}>
        <p className="text-small text-ink-muted">
          {backup.error ? `Couldn't read backup status: ${backup.error}` : "Loading backup status…"}
        </p>
        {backup.error && (
          <button type="button" onClick={() => void refreshBackupStatus()} className={rowButtonClass}>
            Retry
          </button>
        )}
      </div>
    );
  }

  const enabled = status.enabled && status.state !== "off";
  const running = status.state === "uploading" || status.state === "scanning";
  const pill = describeBackup(backup);
  const progress = status.state === "uploading" ? backupRunProgress(status, backup.run) : null;
  const currentPct =
    status.current && status.current.bytesTotal > 0
      ? Math.round((status.current.bytesDone / status.current.bytesTotal) * 100)
      : null;
  // This run while it uploads; otherwise what's left of everything this phone has to back up.
  const settled = status.uploaded + status.skippedDuplicates;
  const meter = progress
    ? { label: "This run", value: progress.done, max: progress.total }
    : status.state === "scanning"
      ? { label: "Checking", value: undefined, max: undefined }
      : status.pending > 0
        ? { label: "Backlog", value: settled, max: settled + status.pending }
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
      <div className={`settings-card overflow-hidden ${cardClass}`}>
        <div className="px-4 py-1">
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
              icon={<AlertIcon size={16} />}
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
            <div className="flex flex-col items-start gap-2">
              {pill && <StatusPill {...pill} href={undefined} short={shortLabel(pill, backup)} />}
              <div className="min-w-0">
                <p className="text-headline text-ink">{statusHeadline(status, backup.run)}</p>
                <p className="mt-0.5 text-footnote text-ink-muted">
                  {status.state === "waiting"
                    ? describeWait(status, now).detail
                    : status.lastBackupAt
                      ? `Last backup ${formatRelativeTime(status.lastBackupAt, now)}`
                      : "Nothing backed up from this phone yet"}
                </p>
              </div>
            </div>

            {meter && (
              <div className="flex flex-col gap-2">
                <TileMeter
                  fluid
                  tiles={20}
                  label={meter.label}
                  value={meter.value}
                  max={meter.max}
                  active={running}
                />
                {progress && status.current && (
                  <p className="truncate text-footnote tabular-nums text-ink-muted">
                    {status.current.name}
                    {currentPct !== null ? ` · ${currentPct}%` : ""}
                  </p>
                )}
              </div>
            )}

            {status.pending >= BACKLOG_NOTE_MIN &&
              (status.state === "uploading" || status.state === "waiting" || status.state === "scanning") && (
                <Callout icon={<ClockIcon size={16} />} tone="info" title={`${status.pending.toLocaleString()} to go`}>
                  Your photos and videos are backed up newest first. GitHub takes roughly {UPLOADS_PER_HOUR} uploads an
                  hour, so this takes {backlogEstimate(status.pending)}. It carries on in the background by itself;
                  you don&apos;t need to keep the app open.
                </Callout>
              )}

            {status.state === "needs_permission" && (
              <Callout
                icon={<AlertIcon size={16} />}
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
                icon={<LockIcon size={16} />}
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
                icon={<BatteryChargingIcon size={16} />}
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

            <StatGrid>
              <Stat label="Backed up" value={status.uploaded.toLocaleString()} />
              <Stat label="Waiting" value={status.pending.toLocaleString()} />
              <Stat label="Already in library" value={status.skippedDuplicates.toLocaleString()} />
              <Stat label="Failed" value={status.failed.toLocaleString()} tone={status.failed > 0 ? "danger" : undefined} />
            </StatGrid>

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

        {enabled && (
          <>
            <Option
              title="Back up using"
              description={
                status.wifiOnly
                  ? "Mobile data is never used. Backups wait for Wi-Fi."
                  : "Uses mobile data when there's no Wi-Fi, but never while roaming."
              }
            >
              <NetworkChoice
                wifiOnly={status.wifiOnly}
                disabled={busy !== null}
                onChange={(wifiOnly) => setOption({ wifiOnly })}
              />
            </Option>
            <div className="px-4 py-1">
              <Switch
                checked={status.chargingOnly}
                onChange={(checked) => setOption({ chargingOnly: checked })}
                label="Only while charging"
                description="Backup always pauses on low battery. Turn this on to back up only while plugged in."
                disabled={busy !== null}
              />
            </div>
            <Option title="Folders" description="Which folders on this phone are backed up.">
              <SegmentedControl
                label="Folders"
                value={status.folders}
                options={FOLDER_OPTIONS}
                disabled={busy !== null}
                onChange={(folders) => setOption({ folders })}
              />
            </Option>
          </>
        )}
      </div>

      {!enabled && !error && (
        <p className="flex items-start gap-2 px-4 text-footnote text-ink-muted">
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
