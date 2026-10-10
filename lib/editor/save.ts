import type { FileTaskSnapshot } from "@/lib/upload/types";

/** "IMG_0042.HEIC" -> "IMG_0042-edited.jpg"; editing an edited copy doesn't stack suffixes. */
export function editedFilename(original: string, extension: "jpg" | "png"): string {
  const base = original.replace(/\.[^./\\]+$/, "").replace(/-edited(?:-\d+)?$/i, "").trim() || "photo";
  return `${base}-edited.${extension}`;
}

export interface UploadProgress {
  /** 0..1 */
  fraction: number;
  label: string;
}

/** Progress of the saved copy through the shared upload queue. */
export function uploadProgress(snapshot: FileTaskSnapshot): UploadProgress {
  const uploaded = snapshot.size > 0 ? snapshot.bytesUploaded / snapshot.size : 0;
  switch (snapshot.status) {
    case "queued":
      return { fraction: 0.04, label: "Waiting to upload…" };
    case "hashing":
      return { fraction: 0.08, label: "Preparing…" };
    case "uploading":
      return { fraction: 0.1 + 0.8 * uploaded, label: "Saving copy…" };
    case "paused":
      return { fraction: 0.1 + 0.8 * uploaded, label: "Waiting for a connection…" };
    case "processing":
      return { fraction: 0.92, label: "Finishing…" };
    case "committing":
      return { fraction: 0.96, label: "Finishing…" };
    default:
      return { fraction: 1, label: "Saved" };
  }
}
