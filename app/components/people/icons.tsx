import type { ReactNode } from "react";

// Icons for the People screens, drawn like app/components/library/icons.tsx.

interface IconProps {
  size?: number;
  className?: string;
}

function Svg({ size = 20, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function FaceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </Svg>
  );
}

/** Face-grouping scan: a face inside viewfinder corners. */
export function ScanFaceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2" />
      <circle cx="12" cy="10" r="2.6" />
      <path d="M7.8 17a4.6 4.6 0 0 1 8.4 0" />
    </Svg>
  );
}

export function MergeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="7.5" cy="8" r="3" />
      <circle cx="16.5" cy="8" r="3" />
      <path d="M3 19.5a4.5 4.5 0 0 1 8.4-2.2M12.6 17.3A4.5 4.5 0 0 1 21 19.5" />
    </Svg>
  );
}

export function EyeOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 8.5 4.2 9.5 7-.4 1.1-1.2 2.5-2.4 3.8M6.4 6.4C4.5 7.7 3.1 9.7 2.5 12c1 2.8 4.5 7 9.5 7 1.6 0 3.1-.4 4.4-1.1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 12c1-2.8 4.5-7 9.5-7s8.5 4.2 9.5 7c-1 2.8-4.5 7-9.5 7s-8.5-4.2-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

/** "Not this person": a person with a minus. */
export function PersonRemoveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10" cy="8.5" r="3.6" />
      <path d="M3.5 20a6.5 6.5 0 0 1 11.2-4.5M16 18.5h5" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5v14M15 5v14" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 5.5v13a1 1 0 0 0 1.5.9l10.4-6.5a1 1 0 0 0 0-1.8L8.5 4.6A1 1 0 0 0 7 5.5Z" />
    </Svg>
  );
}
