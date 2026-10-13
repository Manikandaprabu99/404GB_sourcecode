"use client";

import Link from "next/link";
import { describeBackup, type BackupPill, type BackupPillIcon, type BackupPillTone, type BackupSnapshot } from "@/lib/library/backupStore";
import { useBackupStatus, useWebUploadProgress } from "@/lib/library/hooks";
import StatusBadge, { type StatusBadgeTone, type TileGlyphState } from "@/app/components/ui/StatusBadge";

const TONES: Record<BackupPillTone, StatusBadgeTone> = {
  progress: "live",
  ok: "live",
  warn: "attention",
  action: "neutral",
  muted: "neutral",
};

function glyphFor(tone: BackupPillTone): TileGlyphState {
  if (tone === "progress") return "busy";
  if (tone === "ok") return "done";
  return "waiting";
}

/** The badge's short form of a backup state, in the spirit of `128 TO GO` / `WAITING · WI-FI`
 * (shown uppercase). The full sentence stays the badge's accessible text. Also used by the
 * backup card in Settings. */
export function shortLabel(pill: BackupPill, backup: BackupSnapshot): string {
  const status = backup.status;
  if (pill.tone === "ok") return "Up to date";
  switch (pill.icon) {
    case "sync":
      if (status?.state === "uploading") return status.pending > 0 ? `${status.pending.toLocaleString()} to go` : "Backing up";
      return "Checking";
    case "lock":
      return "Sign in";
    case "update":
      return "Update app";
    case "wifi":
      return "Waiting · Wi-Fi";
    case "signal":
      return "Paused · Roaming";
    case "charging":
      return "Waiting · Charger";
    case "battery":
      return "Paused · Battery";
    case "clock":
      return pill.label.startsWith("GitHub limit") ? "Paused · GitHub limit" : "Starting soon";
    case "off":
      return pill.tone === "action" ? "Backup off" : "Waiting · Offline";
    case "alert":
      if (status?.state === "needs_permission") return "Allow access";
      return status && status.failed > 0 ? `${status.failed.toLocaleString()} failed` : "Check backup";
    default:
      return pill.label;
  }
}

export function StatusPill({
  label,
  short,
  tone,
  href,
}: {
  /** The full sentence (accessible text). */
  label: string;
  /** What the badge shows; defaults to `label`. */
  short?: string;
  tone: BackupPillTone;
  /** Kept for callers; the badge's 2×2 glyph follows the tone instead. */
  icon: BackupPillIcon;
  href?: string;
  /** 0..1 while uploading (the badge's glyph runs instead of showing a fraction). */
  progress?: number;
}) {
  const body = (
    <StatusBadge
      tone={TONES[tone]}
      glyph={glyphFor(tone)}
      srLabel={short && short !== label ? label : undefined}
      className="animate-fade-in"
    >
      {short ?? label}
    </StatusBadge>
  );
  if (!href) return <span role="status" className="flex min-w-0">{body}</span>;
  return (
    // A 44px-tall hit area around the 24px badge.
    <Link href={href} className="relative flex min-w-0 rounded-tile-sm after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']">
      {body}
    </Link>
  );
}

/** Backup state for the Photos header: the phone's automatic backup inside the
 * app, or progress of uploads started from this browser. Renders nothing when
 * there's nothing worth saying. */
export default function BackupStatusPill() {
  const backup = useBackupStatus();
  const web = useWebUploadProgress();

  if (web.active) {
    const toGo = Math.max(0, web.total - web.current + 1);
    return (
      <StatusPill
        label={web.paused ? "Upload paused" : `Uploading ${web.current} of ${web.total}`}
        short={web.paused ? "Paused" : `${toGo.toLocaleString()} to go`}
        tone={web.paused ? "muted" : "progress"}
        icon="sync"
        progress={web.fraction}
        href="/upload"
      />
    );
  }

  const pill = describeBackup(backup);
  if (!pill) return null;
  return <StatusPill {...pill} short={shortLabel(pill, backup)} />;
}
