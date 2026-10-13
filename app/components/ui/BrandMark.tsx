/**
 * The 404GB mark: a 2×2 photo grid with one tile missing (docs/DESIGN.md › App icon) — three
 * signal-lime tiles and a dashed lime outline on ink. Same art as public/icons/brand.svg and
 * the Android launcher icon (apps/mobile/brand/mark.svg).
 *
 * `missing`: "dashed" (still), "breathe" (the outline fades in and out, e.g. while loading)
 * or "fill" (it fills in with lime shortly after mounting, e.g. on the sign-in screen).
 */
export default function BrandMark({
  className,
  title,
  missing = "dashed",
  bare = false,
}: {
  className?: string;
  /** Accessible name; omit when the mark sits next to visible "404GB" text. */
  title?: string;
  missing?: "dashed" | "breathe" | "fill";
  /** Tiles only, without the ink square behind them. */
  bare?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {!bare && <rect width="1024" height="1024" rx="224" fill="#0A0A0B" />}
      <rect x="232" y="232" width="256" height="256" rx="64" fill="#C8F542" />
      <rect
        x="546"
        y="242"
        width="236"
        height="236"
        rx="56"
        fill="none"
        stroke="#C8F542"
        strokeWidth="20"
        strokeDasharray="40 28"
        className={missing === "breathe" ? "animate-breathe" : undefined}
      />
      {missing === "fill" && (
        <rect
          x="536"
          y="232"
          width="256"
          height="256"
          rx="64"
          fill="#C8F542"
          className="origin-center animate-tile-fill [animation-delay:450ms] [animation-duration:360ms] [transform-box:fill-box]"
        />
      )}
      <rect x="232" y="536" width="256" height="256" rx="64" fill="#C8F542" />
      <rect x="536" y="536" width="256" height="256" rx="64" fill="#C8F542" />
    </svg>
  );
}
