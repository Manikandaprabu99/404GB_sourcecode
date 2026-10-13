"use client";

import { useId } from "react";
import StatusBadge from "@/app/components/ui/StatusBadge";
import { TileSwitch } from "@/app/components/ui/Switch";
import { Telemetry } from "@/app/components/ui/SectionLabel";
import { useToast } from "@/app/components/ui/Toast";
import { setBackgroundFaceScan, useBackgroundFaceScan } from "@/lib/faces/background";
import type { FaceScanStatus } from "@/lib/native/backup";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "today 3:40 PM", "yesterday 10:10 PM", "9 Oct 10:10 PM". */
function when(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (sameDay(date, now)) return `today ${time}`;
  if (sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function lastRunFacts(status: FaceScanStatus): string[] {
  if (!status.lastRunAt) return ["No run yet"];
  const facts = [`Last run ${when(status.lastRunAt)}`];
  if (status.lastChecked > 0) {
    facts.push(status.lastChecked === 1 ? "1 photo checked" : `${status.lastChecked.toLocaleString()} photos checked`);
  }
  return facts;
}

/**
 * Settings › People: "Find people while charging" — the phone's background People matching
 * (docs/FACES.md "Background"): the tile switch, and how it's going (running now, or the last
 * run and how many photos it checked). Renders nothing outside the Android app, or in an app
 * build without background matching.
 */
export default function BackgroundScanToggle({ className = "px-4" }: { className?: string }) {
  const { support, status } = useBackgroundFaceScan();
  const toast = useToast();
  const id = useId();
  if (support !== "yes" || !status) return null;

  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const statusId = `${id}-status`;
  const change = (enabled: boolean) => {
    setBackgroundFaceScan(enabled).catch(() => {
      toast({ message: "Couldn't change that. Try again.", tone: "error" });
    });
  };

  return (
    <div className={`py-2 ${className}`} data-testid="background-face-scan">
      <label htmlFor={id} className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4">
        <span className="min-w-0">
          <span id={labelId} className="block text-body font-medium text-ink">
            Find people while charging
          </span>
          <span id={descriptionId} className="mt-0.5 block text-small text-ink-muted">
            About once an hour while the phone charges and 404GB is closed.
          </span>
        </span>
        <TileSwitch
          id={id}
          checked={status.enabled}
          onChange={change}
          labelledBy={labelId}
          describedBy={status.enabled ? `${descriptionId} ${statusId}` : descriptionId}
        />
      </label>
      {status.enabled && (
        <div id={statusId} className="flex flex-col items-start gap-1.5 pb-1.5">
          {status.running ? (
            <StatusBadge tone="live" glyph="busy">
              Running now
            </StatusBadge>
          ) : (
            <Telemetry items={lastRunFacts(status)} className="whitespace-normal" />
          )}
          {!status.running && status.lastError && (
            <p className="text-small text-ink-muted">Stopped early: {status.lastError}</p>
          )}
        </div>
      )}
    </div>
  );
}
