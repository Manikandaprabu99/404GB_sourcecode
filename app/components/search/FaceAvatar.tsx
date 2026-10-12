"use client";

import type { FaceBox } from "@/lib/faces/people";
import type { MediaIndexEntry } from "@/lib/media";
import GalleryThumb from "@/app/gallery/GalleryThumb";
import { PersonIcon } from "@/app/components/library/icons";

interface FaceAvatarProps {
  repoKey: string;
  cover: { mediaId: string; box: FaceBox } | null | undefined;
  /** The cover's index entry, for its proportions (a square crop needs them). */
  entry?: MediaIndexEntry;
  className?: string;
}

/** A person's face, cropped square from the cover item's 320px thumbnail. */
export default function FaceAvatar({ repoKey, cover, entry, className = "h-12 w-12" }: FaceAvatarProps) {
  if (!cover) {
    return (
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-faint ${className}`}>
        <PersonIcon size={20} />
      </span>
    );
  }
  const [bx, by, bw, bh] = cover.box;
  const aspect = entry?.width && entry?.height ? entry.width / entry.height : 1;
  // The square's side in units of the thumbnail's height: the face plus some room, no bigger than the picture.
  const side = Math.min(Math.max(bw * aspect, bh) * 1.4, aspect, 1);
  const sw = side / aspect;
  const sh = side;
  const x0 = Math.min(Math.max(bx + bw / 2 - sw / 2, 0), 1 - sw);
  const y0 = Math.min(Math.max(by + bh / 2 - sh / 2, 0), 1 - sh);
  return (
    <span className={`relative block shrink-0 overflow-hidden rounded-full bg-surface-3 ${className}`}>
      <span
        className="absolute block"
        style={{
          width: `${100 / sw}%`,
          height: `${100 / sh}%`,
          left: `${(-x0 / sw) * 100}%`,
          top: `${(-y0 / sh) * 100}%`,
        }}
      >
        <GalleryThumb
          repoKey={repoKey}
          mediaId={cover.mediaId}
          alt=""
          hasThumbnail={entry ? Boolean(entry.thumb) : true}
          className="h-full w-full object-fill"
        />
      </span>
    </span>
  );
}
