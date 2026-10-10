"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { describeBackup, type BackupPillIcon, type BackupPillTone } from "@/lib/library/backupStore";
import { useBackupStatus, useWebUploadProgress } from "@/lib/library/hooks";
import {
  AlertIcon,
  BatteryChargingIcon,
  CloudCheckIcon,
  CloudOffIcon,
  DownloadAppIcon,
  LockIcon,
  WifiIcon,
} from "@/app/components/library/icons";

const TONES: Record<BackupPillTone, string> = {
  progress: "bg-accent/15 text-accent",
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  action: "border border-border bg-surface-2 text-ink hover:border-border-strong",
  muted: "bg-surface-2 text-ink-muted",
};

function ProgressRing({ value }: { value?: number }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const indeterminate = value === undefined;
  const fraction = Math.min(1, Math.max(0.04, value ?? 0));
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      className={`shrink-0 ${indeterminate ? "animate-spin" : "-rotate-90"}`}
    >
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={indeterminate ? circumference * 0.7 : circumference * (1 - fraction)}
        className="transition-[stroke-dashoffset] duration-320 ease-out-expo"
      />
    </svg>
  );
}

function iconFor(icon: BackupPillIcon, progress?: number): ReactNode {
  switch (icon) {
    case "sync":
      return <ProgressRing value={progress} />;
    case "check":
      return <CloudCheckIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "wifi":
      return <WifiIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "charging":
      return <BatteryChargingIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "alert":
      return <AlertIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "off":
      return <CloudOffIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "update":
      return <DownloadAppIcon size={14} strokeWidth={2} className="shrink-0" />;
    case "lock":
      return <LockIcon size={14} strokeWidth={2} className="shrink-0" />;
  }
}

export function StatusPill({
  label,
  tone,
  icon,
  href,
  progress,
}: {
  label: string;
  tone: BackupPillTone;
  icon: BackupPillIcon;
  href?: string;
  progress?: number;
}) {
  const body = (
    <span
      className={`inline-flex h-7 max-w-full animate-fade-in items-center gap-1.5 rounded-full px-2.5 text-micro font-semibold transition-colors duration-180 ${TONES[tone]}`}
    >
      {iconFor(icon, progress)}
      <span className="truncate">{label}</span>
    </span>
  );
  if (!href) return <span role="status" className="flex min-w-0">{body}</span>;
  return (
    <Link href={href} className="flex min-w-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent">
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
    return (
      <StatusPill
        label={web.paused ? "Upload paused" : `Uploading ${web.current} of ${web.total}`}
        tone={web.paused ? "muted" : "progress"}
        icon="sync"
        progress={web.fraction}
        href="/upload"
      />
    );
  }

  const pill = describeBackup(backup);
  if (!pill) return null;
  return <StatusPill {...pill} />;
}
