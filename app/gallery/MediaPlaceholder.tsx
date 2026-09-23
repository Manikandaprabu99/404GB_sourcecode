/**
 * Fallback tile for media that has no cached thumbnail — e.g. thumbnail
 * generation failed during upload (see lib/upload/uploadQueue.ts: it's
 * best-effort, so `record.thumbnails` can be `{}`). Renders a clear
 * icon-based placeholder instead of an <img>/poster pointed at a thumbnail
 * path that doesn't exist, which would otherwise show as a broken image.
 * The original file is still fully viewable/downloadable regardless — this
 * only affects the small preview.
 */
export default function MediaPlaceholder({
  isVideo,
  className,
}: {
  isVideo?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center bg-surface-2 text-ink-faint ${
        className ?? ""
      }`}
    >
      {isVideo ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-1/3 w-1/3 max-h-16 max-w-16 min-h-6 min-w-6"
          aria-hidden="true"
        >
          <rect x="2.5" y="5" width="19" height="14" rx="2" />
          <path d="M10 9.3v5.4l4.5-2.7L10 9.3z" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-1/3 w-1/3 max-h-16 max-w-16 min-h-6 min-w-6"
          aria-hidden="true"
        >
          <rect x="2.5" y="3.5" width="19" height="17" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 16.5l5-5 4 4 3-3 4 4" />
        </svg>
      )}
    </div>
  );
}
