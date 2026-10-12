import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

function Svg({
  size = 20,
  className,
  strokeWidth = 1.8,
  fill = "none",
  children,
}: IconProps & { fill?: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

export function PhotosIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="8.5" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <path d="m4 17 4.6-4.6a1.6 1.6 0 0 1 2.2 0L15 16.6m-1.6-1.6 1.7-1.7a1.6 1.6 0 0 1 2.2 0L20 16" />
    </Svg>
  );
}

export function AlbumsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="14" height="14" rx="3" />
      <path d="M7 3h10a4 4 0 0 1 4 4v10" />
      <path d="m3.5 18 3.6-3.6a1.5 1.5 0 0 1 2.1 0l2.8 2.8m-1-1 1.2-1.2a1.5 1.5 0 0 1 2.1 0L17 17.6" />
    </Svg>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15V4m-4 4 4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 3.6a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.6 1.1 1.7 1.7 0 0 1 2.4 2.4 1.7 1.7 0 0 0 1.1 2.6 1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.1 2.6 1.7 1.7 0 0 1-2.4 2.4 1.7 1.7 0 0 0-2.6 1.1 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.6-1.1 1.7 1.7 0 0 1-2.4-2.4 1.7 1.7 0 0 0-1.1-2.6 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.1-2.6 1.7 1.7 0 0 1 2.4-2.4 1.7 1.7 0 0 0 2.6-1.1Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M19 12H5m6-6-6 6 6 6" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg strokeWidth={3} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function HeartIcon({ filled, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props} fill={filled ? "currentColor" : "none"}>
      <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 3.9 4 7.5 4c2 0 3.4 1.1 4.5 2.6C13.1 5.1 14.5 4 16.5 4c3.6 0 5.9 3.6 4.7 7.1-1.7 4.8-9.2 9.4-9.2 9.4Z" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg strokeWidth={2} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function AlbumAddIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="14" height="14" rx="3" />
      <path d="M7 3h10a4 4 0 0 1 4 4v10M10 11v6M7 14h6" />
    </Svg>
  );
}

export function AlbumRemoveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="7" width="14" height="14" rx="3" />
      <path d="M7 3h10a4 4 0 0 1 4 4v10M7 14h6" />
    </Svg>
  );
}

export function CoverIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="m3.5 16 4.6-4.6a1.6 1.6 0 0 1 2.2 0L16 17M14 15l1.6-1.6a1.6 1.6 0 0 1 2.2 0l3 3" />
      <path d="m15.5 6.8.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.3.7.3-1.4-1-1 1.4-.2Z" fill="currentColor" strokeWidth={1} />
    </Svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </Svg>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" strokeWidth={0}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </Svg>
  );
}

export function MoreVerticalIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" strokeWidth={0}>
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props} fill="currentColor" strokeWidth={0}>
      <path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.7L9.5 4.6A1 1 0 0 0 8 5.5Z" />
    </Svg>
  );
}

export function SelectIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.2 2.4 2.4 4.6-4.8" />
    </Svg>
  );
}

export function CloudCheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10a4 4 0 0 1 .5 7.97" />
      <path d="m9.5 15 2 2 3.5-3.8" />
    </Svg>
  );
}

export function CloudOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 1.3-2.7M10.2 4.6A6 6 0 0 1 18 10a4 4 0 0 1 2.6 6.6M17 18.5H9" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function SyncIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16m0 4v-4h-4" />
    </Svg>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0" />
      <circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function BatteryChargingIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
      <path d="M22 10.5v3M11.5 8.8 9.5 12h3l-2 3.2" />
    </Svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.9" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

export function DownloadAppIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="6" y="2.5" width="12" height="19" rx="3" />
      <path d="M12 7.5v7m-3-3 3 3 3-3" />
    </Svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </Svg>
  );
}

export function LogoutIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M15 16l4-4-4-4M19 12H8" />
    </Svg>
  );
}

export function GithubIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.26 5.69.42.36.78 1.08.78 2.17 0 1.57-.01 2.83-.01 3.22 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
    </svg>
  );
}

export function ExternalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Svg>
  );
}

export function BatteryLowIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="7" width="17" height="10" rx="2.5" />
      <path d="M22 11v2" />
      <path d="M6 10.5v3" strokeWidth={2.6} />
    </Svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/** Mobile-data bars. */
export function SignalIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 19v-3M10 19v-6M15 19v-9M20 19V7" />
    </Svg>
  );
}

/** Grid density for the Day / Month / Year views: 2, 3 or 4 tiles per row. */
export function ViewGridIcon({ density = 2, ...props }: IconProps & { density?: 2 | 3 | 4 }) {
  const cell = 18 / density;
  const gap = density === 2 ? 2 : 1.5;
  const rects: ReactNode[] = [];
  for (let row = 0; row < density; row++) {
    for (let col = 0; col < density; col++) {
      rects.push(
        <rect
          key={`${row}-${col}`}
          x={3 + col * cell + gap / 2}
          y={3 + row * cell + gap / 2}
          width={cell - gap}
          height={cell - gap}
          rx={density === 2 ? 1.6 : 0.9}
          fill="currentColor"
          stroke="none"
        />
      );
    }
  }
  return <Svg {...props}>{rects}</Svg>;
}

export function DuplicateIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="13" height="13" rx="3" />
      <path d="M16 8V6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v7a3 3 0 0 0 3 3h2" />
    </Svg>
  );
}

/** Out of Trash: an arrow curling back. */
export function RestoreIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
      <path d="M4 4v4.5h4.5M12 8v4l2.5 2" />
    </Svg>
  );
}

export function DeleteForeverIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-9 0 1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
      <path d="m10 12 4 4m0-4-4 4" />
    </Svg>
  );
}

/** "On this day": a calendar page with a heart. */
export function MemoriesIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="M12 18s-3-1.8-3-3.6c0-.9.7-1.6 1.5-1.6.6 0 1.1.3 1.5.9.4-.6.9-.9 1.5-.9.8 0 1.5.7 1.5 1.6 0 1.8-3 3.6-3 3.6Z" fill="currentColor" strokeWidth={1} />
    </Svg>
  );
}

/** A folder, for categories without a picture yet. */
export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
    </Svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </Svg>
  );
}
