"use client";

import { memo, useState, type SyntheticEvent } from "react";
import type { MediaIndexEntry } from "@/lib/media";
import MediaPlaceholder from "../MediaPlaceholder";
import { canDisplayOriginal } from "./format";
import type { Size } from "./geometry";
import { DownloadIcon, ProgressRing } from "./icons";
import type { OriginalView } from "./originals";
import { thumbUrl, useCachedThumb } from "./useCachedThumb";

interface ImageSlideProps {
  item: MediaIndexEntry;
  repoKey: string;
  box: Size;
  active: boolean;
  /** The current item's original, once requested (only passed to the active slide). */
  original: OriginalView | null;
  onAspect: (id: string, aspect: number) => void;
  onRetryOriginal: () => void;
  onDownload: () => void;
  downloadLabel: string;
}

const LAYER = "absolute inset-0 h-full w-full object-contain [-webkit-touch-callout:none]";

function ImageSlide({
  item,
  repoKey,
  box,
  active,
  original,
  onAspect,
  onRetryOriginal,
  onDownload,
  downloadLabel,
}: ImageSlideProps) {
  const hasThumb = Boolean(item.thumb);
  const small = useCachedThumb(repoKey, item.id, 320, hasThumb);
  const [previewSize, setPreviewSize] = useState<1600 | 800 | null>(hasThumb ? 1600 : null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [originalShown, setOriginalShown] = useState<string | null>(null);
  // Once the original has faded in, the preview layers go: transparent PNGs and
  // animated GIFs must not show the (static, opaque-composited) previews beneath.
  const [underlayGoneFor, setUnderlayGoneFor] = useState<string | null>(null);

  // Keep the reserved box honest when stored dimensions are missing or rotated.
  const measure = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
    if (!w || !h) return;
    const measured = w / h;
    const stated = item.width && item.height ? item.width / item.height : null;
    if (!stated || Math.abs(measured - stated) / stated > 0.03) onAspect(item.id, measured);
  };

  const originalUrl = original?.status === "ready" ? original.url : undefined;
  const boxStyle = { width: box.w, height: box.h, transform: "translate(-50%, -50%)" };

  if (!hasThumb) {
    if (originalUrl) {
      return (
        <div className="absolute left-1/2 top-1/2" style={boxStyle}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={originalUrl}
            alt={item.filename}
            draggable={false}
            onLoad={(e) => {
              measure(e);
              setOriginalShown(originalUrl);
            }}
            className={`${LAYER} transition-opacity duration-250 ${originalShown === originalUrl ? "opacity-100" : "opacity-0"}`}
          />
        </div>
      );
    }
    const displayable = canDisplayOriginal(item);
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center">
        <MediaPlaceholder variant="overlay" className="h-40 w-40 rounded-2xl" />
        {!active ? null : !displayable ? (
          <div className="flex max-w-xs flex-col items-center gap-3">
            <p className="text-small text-white/75">
              This photo&apos;s format can&apos;t be shown in the browser, but the original is safe.
            </p>
            <button
              type="button"
              onClick={onDownload}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-small font-semibold text-black transition-transform duration-180 active:scale-95"
            >
              <DownloadIcon size={18} />
              {downloadLabel}
            </button>
          </div>
        ) : original?.status === "error" ? (
          <div className="flex max-w-xs flex-col items-center gap-3">
            <p className="text-small text-white/75">{original.error}</p>
            <button
              type="button"
              onClick={onRetryOriginal}
              className="inline-flex h-11 items-center rounded-full border border-white/25 px-5 text-small font-semibold text-white transition-colors duration-180 hover:bg-white/10"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-small text-white/75" role="status">
            <ProgressRing value={original?.progress ?? null} />
            <span>
              Loading photo
              {original?.progress != null ? ` · ${Math.round(original.progress * 100)}%` : "…"}
            </span>
          </div>
        )}
      </div>
    );
  }

  const underlay = !(active && originalUrl && underlayGoneFor === originalUrl);

  return (
    <div className="absolute left-1/2 top-1/2" style={boxStyle}>
      {underlay && small && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={small} alt="" aria-hidden="true" draggable={false} onLoad={measure} className={LAYER} />
      )}
      {underlay && previewSize && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={previewSize}
          src={thumbUrl(item.id, previewSize)}
          alt={item.filename}
          draggable={false}
          decoding="async"
          onLoad={(e) => {
            measure(e);
            setPreviewLoaded(true);
          }}
          onError={() => {
            setPreviewLoaded(false);
            setPreviewSize((size) => (size === 1600 ? 800 : null));
          }}
          className={`${LAYER} transition-opacity duration-250 ease-out ${previewLoaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
      {active && originalUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={originalUrl}
          alt={item.filename}
          draggable={false}
          decoding="async"
          onLoad={() => setOriginalShown(originalUrl)}
          onTransitionEnd={() => {
            if (originalShown === originalUrl) setUnderlayGoneFor(originalUrl);
          }}
          className={`${LAYER} transition-opacity duration-250 ease-out ${originalShown === originalUrl ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export default memo(ImageSlide);
