"use client";

import { useId } from "react";

/** The 404GB mark: a 2×2 photo grid with one tile missing. Same art as public/icons/brand.svg. */
export default function BrandMark({
  className,
  title,
}: {
  className?: string;
  /** Accessible name; omit when the mark sits next to visible "404GB" text. */
  title?: string;
}) {
  const gradientId = `brand-${useId().replace(/:/g, "")}`;
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
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="224" fill="#060609" />
      <rect x="232" y="232" width="256" height="256" rx="64" fill={`url(#${gradientId})`} />
      <rect
        x="546"
        y="242"
        width="236"
        height="236"
        rx="56"
        fill="none"
        stroke="#818cf8"
        strokeWidth="20"
        strokeDasharray="40 28"
      />
      <rect x="232" y="536" width="256" height="256" rx="64" fill={`url(#${gradientId})`} />
      <rect x="536" y="536" width="256" height="256" rx="64" fill={`url(#${gradientId})`} />
    </svg>
  );
}
