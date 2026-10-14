import type { ScanStatus } from "@/lib/faces/people";

function n(value: number): string {
  return value.toLocaleString();
}

function photos(value: number): string {
  return value === 1 ? "1 photo" : `${n(value)} photos`;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Whether there's still work left (shown as progress while nobody has been found yet). */
export function scanInProgress(status: ScanStatus): boolean {
  return status.total > 0 && status.done < status.total && status.state !== "unavailable";
}

export function scanFraction(status: ScanStatus): number {
  return status.total > 0 ? Math.min(1, status.done / status.total) : 0;
}

/** "Finding people… 1,240 of 8,000 photos" and friends. */
function upToDate(status: ScanStatus): boolean {
  return status.total > 0 && status.done >= status.total;
}

export function scanHeadline(status: ScanStatus): string {
  const progress = `${n(status.done)} of ${photos(status.total)}`;
  if (status.state === "unavailable") return "Face grouping can't run on this device";
  if (status.state === "paused" && status.reason === "other-model") {
    return "Paused: faces were found by a newer version of 404GB";
  }
  if (status.state === "paused") return status.total > 0 && !upToDate(status) ? `Paused · ${progress}` : "Paused";
  if (upToDate(status)) return `Up to date · ${photos(status.total)} checked`;
  if (status.state === "done") return "No photos to check yet";
  if (status.state === "idle" || (status.state === "loading" && status.total === 0)) return "Starting…";
  return status.total > 0 ? `Finding people… ${progress}` : "Finding people…";
}

/** Why it's waiting or paused, when that's worth saying. */
export function scanDetail(status: ScanStatus): string | null {
  if (status.state === "unavailable") return status.message;
  // Nothing left to do: a brief wait for a sync isn't news.
  if (upToDate(status) && status.state !== "paused") return null;
  if (status.state === "error") {
    return status.reason === "signed-out" ? "Sign in again to continue." : "Something went wrong; trying again shortly.";
  }
  switch (status.reason) {
    case "user":
      return "Paused by you.";
    case "hidden":
      // Only the Android app (with the switch on) goes on with the app closed.
      return status.background ? "Continues in the background after you close 404GB." : "Continues when 404GB is open.";
    case "background":
      return "Finding people in the background.";
    case "busy":
      return "Waiting for uploads and syncing to finish.";
    case "offline":
      return "Continues with photos on this device; the rest when you're back online.";
    case "cellular":
      return "Waiting for Wi-Fi to download more previews.";
    case "budget":
      return status.resumeAt
        ? `Used this hour's download allowance; continues at ${clock(status.resumeAt)}.`
        : "Used this hour's download allowance.";
    case "rate-limit":
      return status.resumeAt ? `GitHub asked to slow down; continues at ${clock(status.resumeAt)}.` : "GitHub asked to slow down.";
    case "other-tab":
      return "Another 404GB tab is finding people.";
    case "other-model":
      return "Update the app on this device to continue.";
    default:
      return null;
  }
}
