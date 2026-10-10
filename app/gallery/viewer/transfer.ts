"use client";

// Save / share helpers: the Android app's native Backup plugin when the installed
// build has it, the browser's download link and Web Share API otherwise.

import type { MediaIndexEntry } from "@/lib/media";
import { Backup, type SaveProgress } from "@/lib/native/backup";
import { hasNativePlugin } from "@/lib/native/platform";

export function hasNativeBackup(): boolean {
  return hasNativePlugin("Backup");
}

/** Whether this browser can hand a file of this type to the system share sheet. */
export function canShareFiles(item: Pick<MediaIndexEntry, "mimeType" | "filename">): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array(0)], item.filename || "file", { type: item.mimeType });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export function triggerDownload(href: string, filename: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Downloads the original through the native plugin, reporting progress (0..1, null = unknown). */
export async function nativeTransfer(
  kind: "save" | "share",
  mediaId: string,
  onProgress: (fraction: number | null) => void
): Promise<void> {
  let handle: { remove: () => Promise<void> } | null = null;
  try {
    handle = await Backup.addListener("saveProgress", (progress: SaveProgress) => {
      if (progress.mediaId !== mediaId) return;
      onProgress(progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : null);
    });
  } catch {
    // Older app builds don't send progress; the transfer still works.
  }
  try {
    if (kind === "save") await Backup.saveToDevice({ mediaId });
    else await Backup.shareMedia({ mediaId });
  } finally {
    void handle?.remove().catch(() => {});
  }
}

/** The person closed a share sheet without picking anything: not an error. */
export function isShareCancel(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (typeof err !== "object" || err === null) return false;
  const { message, code } = err as { message?: unknown; code?: unknown };
  return /cancel/i.test(String(message ?? "")) || /cancel/i.test(String(code ?? ""));
}
