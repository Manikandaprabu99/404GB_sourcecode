// Automatic albums ("Categories"), worked out on this device from the media index: where an
// item came from — the phone folder it was backed up from, else what its file name says — plus
// Videos and Edited. Pure (no browser APIs), so plain node scripts can test the rules.

import type { MediaIndexEntry } from "@/lib/media/types";

export type SourceId =
  | "camera"
  | "screenshots"
  | "screen-recordings"
  | "whatsapp"
  | "instagram"
  | "telegram"
  | "snapchat"
  | "facebook"
  | "downloads";

export type CategoryKind = "source" | "videos" | "edited" | "folder";

export interface Category {
  /** A source id, "videos", "edited", or "folder:<name>" for another device folder. */
  id: string;
  name: string;
  kind: CategoryKind;
  /** In the order they were given (newest first). */
  items: MediaIndexEntry[];
}

/** Display order on the Albums screen; other folders follow, biggest first. */
export const SOURCE_CATEGORIES: readonly { id: SourceId; name: string }[] = [
  { id: "camera", name: "Camera" },
  { id: "screenshots", name: "Screenshots" },
  { id: "screen-recordings", name: "Screen recordings" },
  { id: "whatsapp", name: "WhatsApp" },
  { id: "instagram", name: "Instagram" },
  { id: "telegram", name: "Telegram" },
  { id: "snapchat", name: "Snapchat" },
  { id: "facebook", name: "Facebook" },
  { id: "downloads", name: "Downloads" },
];

export const VIDEOS_CATEGORY = { id: "videos", name: "Videos" } as const;
export const EDITED_CATEGORY = { id: "edited", name: "Edited" } as const;

const FOLDER_PREFIX = "folder:";
/** Another device folder becomes a category once it holds this many items. */
export const MIN_FOLDER_ITEMS = 3;

// Device folders, tested in order against the lowercased path ("DCIM/Screenshots" is a
// screenshot folder, not the camera's).
const FOLDER_RULES: readonly [SourceId, RegExp][] = [
  ["screen-recordings", /(^|\/)(screen ?recordings?|screenrecords?|screen ?recorder)(\/|$)/],
  ["screenshots", /(^|\/)screen ?shots?(\/|$)/],
  ["whatsapp", /whatsapp/],
  ["telegram", /telegram/],
  ["instagram", /instagram/],
  ["snapchat", /snapchat/],
  ["facebook", /(^|[/.])(facebook|messenger)([/.]|$)/],
  ["downloads", /^downloads?(\/|$)/],
  ["camera", /^(dcim|camera)$|^dcim\/(camera|100andro|100media|opencamera|\d{3}[a-z0-9_]*)(\/|$)|^pictures\/camera(\/|$)/],
];

// File names, tested in order against the lowercased name without an "-edited" suffix.
// The third element limits a rule to videos or images when the pattern alone is too loose.
const FILENAME_RULES: readonly [SourceId, RegExp, ("video" | "image")?][] = [
  // Screen_Recording_20240101-101010_Chrome.mp4, screenrecord.mp4, "Screen Recording 2024-01-01 at …"
  ["screen-recordings", /^(screen[ _-]?record|screencast)/],
  // Pixel: screen-20240102-101112.mp4
  ["screen-recordings", /^screen-\d{8}-\d{6}/, "video"],
  // Screenshot_20240101-101010_Chrome.jpg, "Screenshot 2024-01-01 at 10.10.10.png"
  ["screenshots", /^screen[ _-]?shot/],
  // IMG-20240101-WA0001.jpg, VID-20240101-WA0002.mp4, "WhatsApp Image 2024-01-01 at …"
  ["whatsapp", /^(img|vid|aud|ptt|stk)-\d{8}-wa\d+/],
  ["whatsapp", /^whatsapp (image|video|gif)/],
  // Telegram Desktop: photo_2024-01-01_10-10-10.jpg, video_2024-01-01_10-10-10.mp4
  ["telegram", /^(photo|video)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/],
  ["telegram", /telegram/],
  // Snapchat-1234567890.jpg
  ["snapchat", /snapchat/],
  // FB_IMG_1577880000000.jpg; Messenger saves received_1234567890123456.jpeg
  ["facebook", /^fb_(img|vid)_\d+/],
  ["facebook", /^received_\d{9,}/],
  // Instagram's CDN names: 123456789_123456789012345_1234567890123456789_n.jpg
  ["instagram", /^(\d+_){2,}n\.[a-z0-9]+$/],
  ["instagram", /instagram/],
  // What browsers name images saved from search results and chat apps.
  ["downloads", /^(download|images|unnamed)( ?\(\d+\))?\.[a-z0-9]+$/],
  // PXL_20240101_101010123.jpg, IMG_20240101_101010.jpg, VID_20240101_101010.mp4, 20240101_101010.jpg,
  // IMG_1234.HEIC (iPhone), DSC_1234.JPG, DSCF1234.JPG, MVI_1234.MOV, GOPR1234.MP4, GX010001.MP4, DJI_0001.JPG
  ["camera", /^pxl_\d{8}_\d{6}/],
  ["camera", /^(img|vid|mvimg)_\d{8}_\d{6}/],
  ["camera", /^\d{8}_\d{6}/],
  ["camera", /^img_\d{4}\.[a-z0-9]+$/],
  ["camera", /^(dsc[fn_]?\d{4,}|mvi_\d{4,}|gopr\d{4,}|gx\d{6}|dji_\d{4,})/],
];

export interface Classification {
  source: SourceId | null;
  /** Another device folder ("folder:<name>"), when no source rule matched. */
  folderId: string | null;
  folderName: string | null;
  video: boolean;
  edited: boolean;
}

/** "DCIM/Camera/" and "/storage/emulated/0/DCIM/Camera" both become "DCIM/Camera". */
export function normalizeFolder(folder: string | undefined): string {
  if (!folder) return "";
  return folder
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^(storage\/emulated\/\d+|sdcard)\//i, "")
    .replace(/\/+$/, "")
    .trim();
}

/** The base name compared with the file-name rules: lowercased, without an "-edited" suffix. */
function nameForRules(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.toLowerCase().replace(/-edited(?:-\d+)?(?=\.[^.]+$)/, "");
}

function kindOf(mimeType: string): "video" | "image" | null {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return null;
}

export function sourceFromFolder(folder: string | undefined): SourceId | null {
  const path = normalizeFolder(folder).toLowerCase();
  if (!path) return null;
  for (const [id, rule] of FOLDER_RULES) if (rule.test(path)) return id;
  return null;
}

export function sourceFromFilename(filename: string, mimeType = ""): SourceId | null {
  const name = nameForRules(filename);
  const kind = kindOf(mimeType.toLowerCase());
  for (const [id, rule, only] of FILENAME_RULES) {
    if (only && only !== kind) continue;
    if (rule.test(name)) return id;
  }
  return null;
}

/** A folder no rule knows, as a category name: its last part ("Pictures/Twitter" → "Twitter"). */
export function folderDisplayName(folder: string | undefined): string | null {
  const path = normalizeFolder(folder);
  if (!path) return null;
  const last = path.split("/").pop()?.trim() ?? "";
  if (!last) return null;
  // An app's package folder ("com.twitter.android") reads better as the app's name.
  const pkg = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.exec(last);
  if (pkg) {
    const part = last.split(".")[1] ?? last;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }
  return last;
}

export function folderCategoryId(name: string): string {
  return `${FOLDER_PREFIX}${name.toLowerCase()}`;
}

export function isFolderCategoryId(id: string): boolean {
  return id.startsWith(FOLDER_PREFIX) && id.length > FOLDER_PREFIX.length;
}

// Index entries are replaced, never mutated, so a classification can be kept per object.
const memo = new WeakMap<object, Classification>();

/** Where an item came from: a known source by its folder, else by its file name, else its own folder. */
export function classify(entry: Pick<MediaIndexEntry, "filename" | "mimeType" | "folder" | "editedFrom">): Classification {
  const cached = memo.get(entry);
  if (cached) return cached;
  const mimeType = entry.mimeType?.toLowerCase() ?? "";
  const source = sourceFromFolder(entry.folder) ?? sourceFromFilename(entry.filename ?? "", mimeType);
  const folderName = source ? null : folderDisplayName(entry.folder);
  const result: Classification = {
    source,
    folderId: folderName ? folderCategoryId(folderName) : null,
    folderName,
    video: mimeType.startsWith("video/"),
    edited: Boolean(entry.editedFrom),
  };
  memo.set(entry, result);
  return result;
}

export function inCategory(entry: MediaIndexEntry, id: string): boolean {
  const c = classify(entry);
  if (id === VIDEOS_CATEGORY.id) return c.video;
  if (id === EDITED_CATEGORY.id) return c.edited;
  if (isFolderCategoryId(id)) return c.folderId === id;
  return c.source === id;
}

/** The categories to show, non-empty only: sources in a fixed order, Videos, Edited, then other folders. */
export function buildCategories(items: readonly MediaIndexEntry[]): Category[] {
  const sources = new Map<SourceId, MediaIndexEntry[]>();
  const folders = new Map<string, { name: string; items: MediaIndexEntry[] }>();
  const videos: MediaIndexEntry[] = [];
  const edited: MediaIndexEntry[] = [];
  for (const item of items) {
    const c = classify(item);
    if (c.source) {
      const list = sources.get(c.source);
      if (list) list.push(item);
      else sources.set(c.source, [item]);
    } else if (c.folderId && c.folderName) {
      const folder = folders.get(c.folderId);
      if (folder) folder.items.push(item);
      else folders.set(c.folderId, { name: c.folderName, items: [item] });
    }
    if (c.video) videos.push(item);
    if (c.edited) edited.push(item);
  }

  const out: Category[] = [];
  for (const { id, name } of SOURCE_CATEGORIES) {
    const list = sources.get(id);
    if (list?.length) out.push({ id, name, kind: "source", items: list });
  }
  if (videos.length > 0) out.push({ ...VIDEOS_CATEGORY, kind: "videos", items: videos });
  if (edited.length > 0) out.push({ ...EDITED_CATEGORY, kind: "edited", items: edited });
  const others = Array.from(folders, ([id, folder]) => ({ id, ...folder }))
    .filter((folder) => folder.items.length >= MIN_FOLDER_ITEMS)
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  for (const folder of others) out.push({ id: folder.id, name: folder.name, kind: "folder", items: folder.items });
  return out;
}

/** One category's items (even below the folder threshold, so its screen keeps working); null if unknown. */
export function findCategory(items: readonly MediaIndexEntry[], id: string): Category | null {
  if (id === VIDEOS_CATEGORY.id || id === EDITED_CATEGORY.id) {
    const kind = id === VIDEOS_CATEGORY.id ? "videos" : "edited";
    const name = id === VIDEOS_CATEGORY.id ? VIDEOS_CATEGORY.name : EDITED_CATEGORY.name;
    return { id, name, kind, items: items.filter((item) => inCategory(item, id)) };
  }
  const source = SOURCE_CATEGORIES.find((s) => s.id === id);
  if (source) return { id, name: source.name, kind: "source", items: items.filter((item) => inCategory(item, id)) };
  if (!isFolderCategoryId(id)) return null;
  const matching = items.filter((item) => inCategory(item, id));
  const name = matching.length > 0 ? classify(matching[0]).folderName : null;
  return name ? { id, name, kind: "folder", items: matching } : null;
}

/** The item a category card shows: its newest item that has a thumbnail. */
export function categoryCover(items: readonly MediaIndexEntry[]): MediaIndexEntry | undefined {
  return items.find((item) => item.thumb) ?? items[0];
}

/** Where a category opens (a query parameter: the static export has no dynamic routes). */
export function categoryHref(id: string): string {
  return `/albums/category?id=${encodeURIComponent(id)}`;
}
