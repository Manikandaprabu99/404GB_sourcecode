import type { MediaIndexEntry } from "@/lib/media";

export function isVideoItem(item: Pick<MediaIndexEntry, "mimeType">): boolean {
  return item.mimeType.startsWith("video/");
}

// Image types every browser engine we target can decode in an <img>.
const DISPLAYABLE_IMAGE =
  /^image\/(jpeg|jpg|pjpeg|png|apng|webp|gif|avif|bmp|x-ms-bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/i;

/** False for originals the browser can't draw (HEIC/HEIF, TIFF, RAW…): show the preview instead. */
export function canDisplayOriginal(item: Pick<MediaIndexEntry, "mimeType">): boolean {
  return DISPLAYABLE_IMAGE.test(item.mimeType);
}

export function isHeic(item: Pick<MediaIndexEntry, "mimeType" | "filename">): boolean {
  return /^image\/hei[cf](-sequence)?$/i.test(item.mimeType) || /\.(heic|heif)$/i.test(item.filename);
}

const TYPE_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG photo",
  "image/jpg": "JPEG photo",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "image/gif": "GIF",
  "image/avif": "AVIF image",
  "image/heic": "HEIC photo",
  "image/heif": "HEIF photo",
  "image/tiff": "TIFF image",
  "image/bmp": "Bitmap image",
  "image/svg+xml": "SVG image",
  "video/mp4": "MP4 video",
  "video/quicktime": "QuickTime video",
  "video/webm": "WebM video",
  "video/3gpp": "3GP video",
  "video/x-matroska": "MKV video",
};

export function typeLabel(mimeType: string): string {
  const known = TYPE_LABELS[mimeType.toLowerCase()];
  if (known) return known;
  const [kind, sub = ""] = mimeType.split("/");
  const name = sub.replace(/^x-/, "").toUpperCase();
  if (kind === "video") return name ? `${name} video` : "Video";
  if (kind === "image") return name ? `${name} image` : "Image";
  return mimeType || "Unknown";
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Tue, Oct 7, 2026, 2:14 PM" */
export function formatDateTime(iso: string | undefined): string | null {
  const date = parseDate(iso);
  if (!date) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Viewer title: "Oct 7, 2026" (year omitted for the current year) and "2:14 PM". */
export function viewerTitle(iso: string | undefined): { date: string; time: string } | null {
  const date = parseDate(iso);
  if (!date) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return {
    date: date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }),
    time: date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

export function megapixels(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const mp = (width * height) / 1_000_000;
  return mp >= 0.1 ? `${mp >= 10 ? Math.round(mp) : mp.toFixed(1)} MP` : null;
}
