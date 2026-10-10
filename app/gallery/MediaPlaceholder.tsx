/**
 * Fallback tile for media that has no thumbnail (generation is best-effort, so
 * `record.thumbnails` can be empty). Shows a clear icon instead of a broken
 * image; the original stays fully viewable and downloadable.
 */
export default function MediaPlaceholder({
  isVideo,
  className,
  variant = "surface",
}: {
  isVideo?: boolean;
  className?: string;
  /** "overlay" for the always-dark photo viewer. */
  variant?: "surface" | "overlay";
}) {
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center ${
        variant === "overlay" ? "bg-white/[0.06] text-white/40" : "bg-surface-2 text-ink-faint"
      } ${className ?? ""}`}
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
        >
          <rect x="2.5" y="3.5" width="19" height="17" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
          <path d="M4 16.5l5-5 4 4 3-3 4 4" />
        </svg>
      )}
    </div>
  );
}
