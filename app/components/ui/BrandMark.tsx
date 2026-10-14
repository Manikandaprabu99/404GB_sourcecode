import { useId } from "react";

/** The 404GB mark (same art as public/icons/brand.svg); `bare` draws the white glyph only.
 * `missing` is accepted for the old API and ignored. */
export default function BrandMark({
  className,
  title,
  bare = false,
}: {
  className?: string;
  /** Accessible name; omit when the mark sits next to visible "404GB" text. */
  title?: string;
  missing?: "dashed" | "breathe" | "fill";
  bare?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const bg = `${id}-bg`;
  const sheen = `${id}-sheen`;
  const front = `${id}-front`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1660EB" />
          <stop offset="1" stopColor="#0A2878" />
        </linearGradient>
        <radialGradient id={sheen} cx="300" cy="140" r="820" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <clipPath id={front}>
          <rect x="228" y="397" width="472" height="392" rx="84" />
        </clipPath>
      </defs>
      {!bare && (
        <>
          <rect width="1024" height="1024" rx="232" fill={`url(#${bg})`} />
          <rect width="1024" height="1024" rx="232" fill={`url(#${sheen})`} />
        </>
      )}
      <rect
        x="348"
        y="261"
        width="432"
        height="356"
        rx="76"
        transform="rotate(9 564 439)"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity={bare ? 0.7 : 0.62}
        strokeWidth="40"
      />
      {!bare && <rect x="228" y="397" width="472" height="392" rx="84" fill="none" stroke={`url(#${bg})`} strokeWidth="56" />}
      <g clipPath={`url(#${front})`}>
        <rect x="228" y="397" width="472" height="392" fill="#FFFFFF" />
        <path d="M228 789V712L372 584Q392 566 412 584L532 692L580 650Q598 634 616 650L700 724V789Z" fill="#1A5BE0" />
        <circle cx="582" cy="505" r="38" fill="#1A5BE0" />
      </g>
    </svg>
  );
}
