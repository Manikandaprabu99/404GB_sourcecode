"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { loadThumbnailObjectUrl } from "@/lib/cache";
import type { FaceBox } from "@/lib/faces/people";
import { adoptThumbUrl, peekThumbUrl, releaseThumbUrl, retainThumbUrl, thumbKey } from "@/lib/library/thumbUrls";
import { FaceIcon } from "./icons";

// The 800px thumbnail: a face is often a tenth of the picture, too few pixels at 320px.
const SIZE = 800;
/** Room around the face box (hair, chin) in the round crop. */
const CONTEXT = 1.7;

/** A thumbnail object URL from the shared caches (IndexedDB + in-memory URLs). */
function useThumbUrl(repoKey: string, mediaId: string | null): string | null {
  const key = mediaId ? thumbKey(repoKey, mediaId, SIZE) : "";
  const [url, setUrl] = useState<{ key: string; url: string } | null>(() => {
    const cached = key ? peekThumbUrl(key) : null;
    return cached ? { key, url: cached } : null;
  });

  useEffect(() => {
    if (!mediaId || !key) return;
    const cached = peekThumbUrl(key);
    if (cached) {
      retainThumbUrl(key);
      setUrl((prev) => (prev?.key === key && prev.url === cached ? prev : { key, url: cached }));
      return () => releaseThumbUrl(key);
    }
    let cancelled = false;
    let retained = false;
    const controller = new AbortController();
    loadThumbnailObjectUrl(repoKey, mediaId, SIZE, controller.signal)
      .then((fresh) => {
        const adopted = adoptThumbUrl(key, fresh);
        if (cancelled) return;
        retainThumbUrl(key);
        retained = true;
        setUrl({ key, url: adopted });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
      if (retained) releaseThumbUrl(key);
    };
  }, [key, repoKey, mediaId]);

  return url?.key === key ? url.url : null;
}

/** Where the image goes so the face box fills a square, as percentages of that square. */
export function faceCropStyle(box: FaceBox, width: number, height: number): CSSProperties {
  const [bx, by, bw, bh] = box;
  const side = Math.min(Math.max(bw * width, bh * height) * CONTEXT, width, height);
  const cx = (bx + bw / 2) * width;
  const cy = (by + bh / 2) * height;
  const left = Math.min(Math.max(cx - side / 2, 0), width - side);
  const top = Math.min(Math.max(cy - side / 2, 0), height - side);
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${(width / side) * 100}%`,
    height: `${(height / side) * 100}%`,
    left: `${(-left / side) * 100}%`,
    top: `${(-top / side) * 100}%`,
  };
}

interface FaceAvatarProps {
  repoKey: string;
  face: { mediaId: string; box: FaceBox } | null;
  /** Size and shape, e.g. "h-16 w-16". */
  className?: string;
  /** Dims and greys the face (a hidden person). */
  muted?: boolean;
}

/** A person's face, cropped round from the thumbnail of the photo it was found in. */
export default function FaceAvatar({ repoKey, face, className = "h-16 w-16", muted }: FaceAvatarProps) {
  const url = useThumbUrl(repoKey, face?.mediaId ?? null);
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(null);
  const dims = natural && natural.url === url ? natural : null;

  return (
    <span
      className={`relative block shrink-0 overflow-hidden rounded-full bg-surface-3 ${className} ${
        muted ? "opacity-60 grayscale" : ""
      }`}
    >
      {!face ? (
        <span className="flex h-full w-full items-center justify-center text-ink-faint">
          <FaceIcon size={20} />
        </span>
      ) : !url ? (
        <span className="skeleton block h-full w-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={(e) =>
            setNatural({ url, width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
          }
          className={dims ? "animate-fade-in" : "opacity-0"}
          style={dims ? faceCropStyle(face.box, dims.width, dims.height) : { position: "absolute", width: 1, height: 1 }}
        />
      )}
    </span>
  );
}
