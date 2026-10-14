"use client";

import StatusBadge from "@/app/components/ui/StatusBadge";
import Switch from "@/app/components/ui/Switch";
import { useToast } from "@/app/components/ui/Toast";
import { setBackgroundFaceScan, useBackgroundFaceScan } from "@/lib/faces/background";
import type { FaceScanStatus } from "@/lib/native/backup";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "10:42 AM" today, "yesterday 10:10 PM", "9 Oct 10:10 PM". */
function when(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (sameDay(date, now)) return time;
  if (sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return `yesterday ${time}`;
  return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

function photos(count: number): string {
  return count === 1 ? "1 photo" : `${count.toLocaleString()} photos`;
}

/** What the background runs are doing, in one line. */
function headline(status: FaceScanStatus): string {
  if (status.running) return `Running now · ${status.checkedNow.toLocaleString()} checked`;
  if (status.lastRunAt) return `Last run ${when(status.lastRunAt)} · ${photos(status.lastChecked)} checked`;
  return status.chargingOnly ? "Runs a few minutes after you close 404GB, while it charges" : "Runs a few minutes after you close 404GB";
}

/** Why the last run stopped early or the last one due was skipped, else what comes next. */
function detail(status: FaceScanStatus): string | null {
  if (status.running) return null;
  if (status.lastError) return `Stopped early: ${status.lastError}`;
  switch (status.lastReason) {
    case "battery-low":
      return "Waiting for 30 % battery or a charger.";
    case "power-save":
      return "Waiting while Battery Saver is on, or for a charger.";
    case "not-charging":
      return "Waiting for a charger.";
    case "deadline":
      return status.pending ? "More to do: the next run is queued." : "More to do: continues next run.";
    case "done":
      return "All photos checked. New ones are matched after backup.";
    default:
      return status.lastRunAt ? "Runs a few minutes after you close 404GB." : null;
  }
}

/**
 * Settings › People: "Find people in the background" and "Only while charging" (docs/FACES.md
 * "Background"), with how the runs go. Renders nothing outside the Android app.
 */
export default function BackgroundScanToggle({ className = "px-4" }: { className?: string }) {
  const { support, status } = useBackgroundFaceScan();
  const toast = useToast();
  if (support !== "yes" || !status) return null;

  const change = (patch: { enabled?: boolean; chargingOnly?: boolean }) => {
    setBackgroundFaceScan(patch).catch(() => {
      toast({ message: "Couldn't change that. Try again.", tone: "error" });
    });
  };
  const more = status.enabled ? detail(status) : null;

  return (
    <div className={className} data-testid="background-face-scan">
      <Switch
        checked={status.enabled}
        onChange={(enabled) => change({ enabled })}
        label="Find people in the background"
        description="Keeps matching faces after you close 404GB."
      />
      <Switch
        checked={status.chargingOnly}
        onChange={(chargingOnly) => change({ chargingOnly })}
        label="Only while charging"
        description={status.chargingOnly ? "Waits for a charger." : "On battery: short runs, only above 30 % and never in Battery Saver."}
        disabled={!status.enabled}
      />
      {status.enabled && (
        <div data-testid="background-face-scan-status" aria-live="polite" className="flex flex-col items-start gap-1 pb-3 pt-1">
          {status.running ? (
            <StatusBadge tone="live" glyph="busy">
              {headline(status)}
            </StatusBadge>
          ) : (
            <p className="text-small font-medium text-ink">{headline(status)}</p>
          )}
          {more && <p className="text-small text-ink-muted">{more}</p>}
        </div>
      )}
    </div>
  );
}
