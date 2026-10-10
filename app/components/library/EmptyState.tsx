import type { ReactNode } from "react";
import {
  AlbumsIcon,
  AlertIcon,
  CloudOffIcon,
  HeartIcon,
  PhotosIcon,
  PlayIcon,
  SearchIcon,
} from "./icons";

export type EmptyIllustration = "photos" | "albums" | "search" | "favorites" | "videos" | "offline" | "error";

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-small font-semibold text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-elevated active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-full border border-border px-5 py-2.5 text-small font-semibold text-ink transition-all duration-180 ease-out-expo hover:border-border-strong hover:bg-surface-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

function iconFor(kind: EmptyIllustration): ReactNode {
  switch (kind) {
    case "photos":
      return <PhotosIcon size={38} />;
    case "albums":
      return <AlbumsIcon size={38} />;
    case "search":
      return <SearchIcon size={34} />;
    case "favorites":
      return <HeartIcon size={34} />;
    case "videos":
      return <PlayIcon size={30} />;
    case "offline":
      return <CloudOffIcon size={34} />;
    case "error":
      return <AlertIcon size={34} />;
  }
}

function Illustration({ kind }: { kind: EmptyIllustration }) {
  if (kind === "photos" || kind === "albums") {
    return (
      <div aria-hidden="true" className="relative mx-auto h-32 w-44">
        <div className="absolute inset-x-8 bottom-2 top-6 rounded-full bg-accent/25 blur-2xl" />
        <div className="absolute left-5 top-7 h-[5.5rem] w-[4.5rem] -rotate-[14deg] rounded-2xl border border-border bg-surface-2 shadow-soft" />
        <div className="absolute right-5 top-7 h-[5.5rem] w-[4.5rem] rotate-[14deg] rounded-2xl border border-border bg-surface-2 shadow-soft" />
        <div className="absolute left-1/2 top-2 flex h-[6.5rem] w-[5.5rem] -translate-x-1/2 items-center justify-center rounded-2xl border border-border-strong bg-surface text-accent shadow-elevated">
          {iconFor(kind)}
        </div>
      </div>
    );
  }
  const tone = kind === "error" ? "text-danger" : kind === "offline" ? "text-ink-muted" : "text-accent";
  return (
    <div aria-hidden="true" className="relative mx-auto h-28 w-28">
      <div className={`absolute inset-3 rounded-full blur-2xl ${kind === "error" ? "bg-danger/20" : "bg-accent/20"}`} />
      <div
        className={`absolute inset-4 flex items-center justify-center rounded-3xl border border-border-strong bg-surface shadow-elevated ${tone}`}
      >
        {iconFor(kind)}
      </div>
    </div>
  );
}

interface EmptyStateProps {
  illustration: EmptyIllustration;
  title: string;
  message?: ReactNode;
  /** Action buttons. */
  children?: ReactNode;
}

export default function EmptyState({ illustration, title, message, children }: EmptyStateProps) {
  return (
    <div className="mx-auto flex max-w-sm animate-fade-in-up flex-col items-center px-6 py-14 text-center">
      <Illustration kind={illustration} />
      <h2 className="mt-6 text-h3 font-semibold tracking-tight text-ink">{title}</h2>
      {message && <p className="mt-2 text-body text-ink-muted">{message}</p>}
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{children}</div>}
    </div>
  );
}
