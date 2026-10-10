import type { MediaIndexEntry } from "@/lib/media/types";

const EDITABLE_TYPES = /^image\/(jpeg|jpg|pjpeg|png|webp|gif|avif|bmp)$/i;

/** HEIC/HEIF (no browser decoder), SVG and videos can't be edited. Kept out of
 * PhotoEditor.tsx so checking it doesn't pull the editor into the viewer bundle. */
export function canEdit(media: Pick<MediaIndexEntry, "mimeType">): boolean {
  return EDITABLE_TYPES.test(media.mimeType);
}
