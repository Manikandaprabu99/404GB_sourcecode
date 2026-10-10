"use client";

// Placeholder for the photo editor (filters, adjustments, crop/rotate, save as copy).
// Keep the exported names and props stable: the viewer imports them.

import type { MediaIndexEntry } from "@/lib/media";

export interface PhotoEditorProps {
  media: MediaIndexEntry;
  onClose: () => void;
  /** Called after the edited copy is saved; null if it was already in the library. */
  onSaved: (newMediaId: string | null) => void;
}

export function canEdit(media: Pick<MediaIndexEntry, "mimeType">): boolean {
  return /^image\/(jpeg|png|webp|gif|avif)$/i.test(media.mimeType);
}

export default function PhotoEditor({ onClose }: PhotoEditorProps) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black text-white">
      <button type="button" onClick={onClose} className="rounded-full bg-white/10 px-4 py-2">
        Close
      </button>
    </div>
  );
}
