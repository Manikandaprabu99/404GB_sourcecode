/**
 * Fallback tile for media that has no thumbnail (generation is best-effort, so
 * `record.thumbnails` can be empty): the brand's missing tile, a dashed outline with the
 * kind of item in it, instead of a broken image. The original stays fully viewable and
 * downloadable.
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
  const overlay = variant === "overlay";
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center ${overlay ? "bg-white/[0.06] text-white/45" : "bg-surface-2 text-ink-faint"} ${
        className ?? ""
      }`}
    >
      <span
        className={`flex aspect-square w-[42%] min-w-7 max-w-20 items-center justify-center rounded-[24%] border-[1.5px] border-dashed ${
          overlay ? "border-white/25" : "border-border-strong"
        }`}
      >
        {isVideo ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-[52%] w-[52%]">
            <rect x="2.5" y="5" width="19" height="14" rx="3" />
            <path d="M10 9.3v5.4l4.5-2.7L10 9.3z" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-[52%] w-[52%]">
            <rect x="2.5" y="3.5" width="19" height="17" rx="3" />
            <circle cx="8.5" cy="9.5" r="1.5" fill="currentColor" stroke="none" />
            <path d="M4 16.5l5-5 4 4 3-3 4 4" />
          </svg>
        )}
      </span>
    </div>
  );
}
