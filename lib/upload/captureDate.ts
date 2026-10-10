// Capture time from EXIF or the MP4/MOV header, reading small File.slice()s only, never a whole video.

import { mediaMimeType } from "./mimeType";

// Seconds from the QuickTime epoch (1904-01-01) to the Unix epoch.
const QUICKTIME_EPOCH_OFFSET_S = 2082844800;
const EARLIEST_PHOTO_MS = Date.UTC(1900, 0, 1);
// MP4/MOV headers older than this are junk (zeroed or wrongly-based clocks).
const EARLIEST_VIDEO_MS = Date.UTC(1995, 0, 1);
const FUTURE_TOLERANCE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_BOXES_PER_LEVEL = 64;
const MAX_WEBP_CHUNKS = 64;
const MAX_EXIF_BYTES = 1024 * 1024;

const EXIF_TAGS = [
  "DateTimeOriginal",
  "CreateDate",
  "ModifyDate",
  "OffsetTimeOriginal",
  "OffsetTimeDigitized",
  "OffsetTime",
];

function plausible(ms: number, earliest: number): boolean {
  return Number.isFinite(ms) && ms >= earliest && ms <= Date.now() + FUTURE_TOLERANCE_MS;
}

async function readView(file: Blob, start: number, length: number): Promise<DataView> {
  const end = Math.min(file.size, start + length);
  return new DataView(await file.slice(start, Math.max(start, end)).arrayBuffer());
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );
}

/** "+05:30" / "-0700" / "Z" → minutes east of UTC. */
function parseOffsetMinutes(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "Z") return 0;
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(trimmed);
  if (!match) return undefined;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** EXIF "YYYY:MM:DD HH:MM:SS" (no zone: local time unless an offset tag says otherwise). */
export function parseExifDate(value: unknown, offset?: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
  if (!match) return undefined;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = match[6] ? Number(match[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const offsetMinutes = parseOffsetMinutes(offset);
  const ms =
    offsetMinutes === undefined
      ? new Date(year, month - 1, day, hour, minute, second).getTime()
      : Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  return plausible(ms, EARLIEST_PHOTO_MS) ? ms : undefined;
}

/** WebP keeps EXIF in a RIFF "EXIF" chunk, often after the image data; returns its TIFF bytes. */
async function readWebpExif(file: Blob): Promise<Uint8Array | null> {
  const header = await readView(file, 0, 12);
  if (header.byteLength < 12 || fourCC(header, 0) !== "RIFF" || fourCC(header, 8) !== "WEBP") return null;
  let offset = 12;
  for (let i = 0; i < MAX_WEBP_CHUNKS && offset + 8 <= file.size; i++) {
    const chunk = await readView(file, offset, 8);
    if (chunk.byteLength < 8) return null;
    const size = chunk.getUint32(4, true);
    if (fourCC(chunk, 0) === "EXIF") {
      if (size > MAX_EXIF_BYTES) return null;
      let bytes = new Uint8Array(await file.slice(offset + 8, offset + 8 + size).arrayBuffer());
      // Some encoders keep the JPEG-style "Exif\0\0" prefix before the TIFF header.
      if (bytes.length > 6 && String.fromCharCode(...Array.from(bytes.subarray(0, 4))) === "Exif") {
        bytes = bytes.subarray(6);
      }
      return bytes;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

async function readExifCaptureTime(file: Blob, mimeType: string): Promise<number | undefined> {
  const { default: exifr } = await import("exifr");
  const input = mimeType === "image/webp" ? await readWebpExif(file) : file;
  if (!input) return undefined;
  const tags = (await exifr.parse(input, {
    pick: EXIF_TAGS,
    reviveValues: false,
    translateValues: false,
  })) as Record<string, unknown> | undefined;
  if (!tags) return undefined;
  return (
    parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal) ??
    parseExifDate(tags.CreateDate, tags.OffsetTimeDigitized) ??
    parseExifDate(tags.ModifyDate, tags.OffsetTime)
  );
}

interface BoxRange {
  start: number;
  end: number;
}

/** Finds the first `type` box among the sibling boxes in [start, end), reading only box headers. */
async function findBox(file: Blob, start: number, end: number, type: string): Promise<BoxRange | null> {
  let offset = start;
  for (let i = 0; i < MAX_BOXES_PER_LEVEL && offset + 8 <= end; i++) {
    const header = await readView(file, offset, 16);
    if (header.byteLength < 8) return null;
    const boxType = fourCC(header, 4);
    // Box types are printable ASCII (© appears as 0xA9); anything else isn't an MP4/MOV.
    if (!/^[\x20-\x7e\xa9]{4}$/.test(boxType)) return null;
    let size = header.getUint32(0);
    let headerSize = 8;
    if (size === 1) {
      if (header.byteLength < 16) return null;
      size = header.getUint32(8) * 2 ** 32 + header.getUint32(12);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize) return null;
    if (boxType === type) return { start: offset + headerSize, end: Math.min(end, offset + size) };
    offset += size;
  }
  return null;
}

/** QuickTime-epoch seconds → Unix ms, or undefined for zero/implausible values. */
export function quickTimeSecondsToMs(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const ms = (seconds - QUICKTIME_EPOCH_OFFSET_S) * 1000;
  if (plausible(ms, EARLIEST_VIDEO_MS)) return ms;
  // Some encoders write Unix seconds into the QuickTime field.
  return plausible(seconds * 1000, Date.UTC(2000, 0, 1)) ? seconds * 1000 : undefined;
}

/** creation_time from moov/mvhd (version 0: 32-bit, version 1: 64-bit), wherever moov sits. */
export async function readMovieCreationTime(file: Blob): Promise<number | undefined> {
  const moov = await findBox(file, 0, file.size, "moov");
  if (!moov) return undefined;
  const mvhd = await findBox(file, moov.start, moov.end, "mvhd");
  if (!mvhd) return undefined;
  const view = await readView(file, mvhd.start, 12);
  if (view.byteLength < 8) return undefined;
  const version = view.getUint8(0);
  if (version === 1) {
    if (view.byteLength < 12) return undefined;
    return quickTimeSecondsToMs(view.getUint32(4) * 2 ** 32 + view.getUint32(8));
  }
  return version === 0 ? quickTimeSecondsToMs(view.getUint32(4)) : undefined;
}

/** ISO 8601 capture time for an upload; falls back to the file's modification time. */
export async function readCaptureDate(file: File): Promise<string | undefined> {
  const mimeType = mediaMimeType(file) ?? "";
  let ms: number | undefined;
  try {
    if (mimeType.startsWith("video/")) ms = await readMovieCreationTime(file);
    else if (mimeType.startsWith("image/")) ms = await readExifCaptureTime(file, mimeType);
  } catch {
    ms = undefined;
  }
  if (ms === undefined && Number.isFinite(file.lastModified) && file.lastModified > 0) {
    ms = file.lastModified;
  }
  return ms === undefined ? undefined : new Date(ms).toISOString();
}
