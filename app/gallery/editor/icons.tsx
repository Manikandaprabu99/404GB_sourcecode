import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

function Icon({ size = 22, className, children }: IconProps & { children: ReactNode }) {
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
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  );
}

export function FiltersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="9" r="5" />
      <circle cx="8.5" cy="15" r="5" />
      <circle cx="15.5" cy="15" r="5" />
    </Icon>
  );
}

/** Two sliders with square knobs, the app's tile knob. */
export function AdjustIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 7h8.5M18 7h2.5M3.5 17h2.5M12 17h8.5" />
      <rect x="12" y="4" width="6" height="6" rx="1.6" />
      <rect x="6" y="14" width="6" height="6" rx="1.6" />
    </Icon>
  );
}

export function CropIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M2 6h14a2 2 0 0 1 2 2v14" />
    </Icon>
  );
}

export function RotateLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Icon>
  );
}

export function RotateRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </Icon>
  );
}

export function FlipIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3 7 5 5-5 5V7zM21 7l-5 5 5 5V7z" />
      <path d="M12 2v2M12 8v2M12 14v2M12 20v2" />
    </Icon>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  );
}

export function CompareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 19H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3M16 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3" />
      <path d="M12 3v18" />
    </Icon>
  );
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Icon>
  );
}

export function ContrastIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function DropletIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 5.5 12 3c-.5 2.5-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7z" />
    </Icon>
  );
}

export function ThermometerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0z" />
    </Icon>
  );
}

export function VignetteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="12" r="5" />
    </Icon>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5h.01" />
    </Icon>
  );
}

export function SpinnerIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={`animate-spin ${className ?? ""}`} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
