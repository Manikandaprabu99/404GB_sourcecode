import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/app/components/ui/Button";
import SectionLabel from "@/app/components/ui/SectionLabel";

// Settings building blocks (docs/DESIGN.md › Cards, List rows, Bento tiles): cards on the
// surface with a hairline in dark and a soft shadow on paper, 56px rows with a 36px icon
// tile, telemetry section labels between groups.

export type IconTone = "neutral" | "accent" | "accent-2" | "warning" | "danger";

const ICON_TONES: Record<IconTone, string> = {
  neutral: "bg-surface-2 text-ink-muted",
  accent: "bg-accent/[0.14] text-accent",
  "accent-2": "bg-accent-2/[0.14] text-accent-2",
  warning: "bg-warning/[0.14] text-warning",
  danger: "bg-danger/[0.14] text-danger",
};

/** The 36px rounded-square icon holder used by rows and bento tiles. */
export function IconTile({ tone = "neutral", children, className }: { tone?: IconTone; children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-tile ${ICON_TONES[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

export const cardClass =
  "rounded-card bg-surface shadow-soft dark:border dark:border-border/60 dark:shadow-none";

export function SettingsSection({ title, children, trailing }: { title: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <SectionLabel className="px-1" trailing={trailing}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`divide-y divide-border/60 overflow-hidden ${cardClass} ${className ?? ""}`}>{children}</div>;
}

export function SettingsRow({
  icon,
  iconTone,
  title,
  description,
  trailing,
  children,
}: {
  icon?: ReactNode;
  iconTone?: IconTone;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[56px] items-start gap-3.5 px-4 py-3">
      {icon && (
        <IconTile tone={iconTone} className="mt-0.5">
          {icon}
        </IconTile>
      )}
      <div className="min-w-0 flex-1 self-center">
        <div className="text-body font-medium text-ink">{title}</div>
        {description && <div className="mt-0.5 text-small text-ink-muted">{description}</div>}
        {children}
      </div>
      {trailing && <div className="shrink-0 self-center">{trailing}</div>}
    </div>
  );
}

/** Small secondary button for rows (36px, 44px hit area). */
export const rowButtonClass = buttonClass({ variant: "secondary", size: "sm" });

/** Two columns of bento tiles (three from `sm`), e.g. Settings › Library. */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${className ?? ""}`}>{children}</div>;
}

/**
 * A square-ish card: icon tile, title and a mono value (a count, a size). A link with `href`,
 * a button with `onClick`, else a plain card that can hold its own controls (`children`).
 */
export function BentoTile({
  icon,
  iconTone = "neutral",
  title,
  value,
  href,
  onClick,
  children,
  className,
}: {
  icon: ReactNode;
  iconTone?: IconTone;
  title: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const interactive = Boolean(href || onClick);
  const body = (
    <>
      <IconTile tone={iconTone}>{icon}</IconTile>
      <span className="mt-auto flex min-w-0 flex-col gap-1 pt-4">
        <span className="truncate text-body font-medium text-ink">{title}</span>
        {value !== undefined && <span className="telemetry truncate text-ink-muted">{value}</span>}
      </span>
      {children}
    </>
  );
  const classes = `flex min-h-[120px] min-w-0 flex-col items-start p-4 text-left ${cardClass} ${
    interactive ? "transition-[background-color,transform] duration-180 ease-out-expo hover:bg-surface-2 active:scale-[0.98]" : ""
  } ${className ?? ""}`;
  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/** A 2×2 (or wider) grid of telemetry stats: label above, mono value below. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-control bg-border/60 ${className ?? ""}`}>{children}</dl>;
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-3.5 py-3">
      {/* Wraps instead of truncating: `ALREADY IN LIBRARY` is wider than a 360px phone's cell. */}
      <dt className="telemetry text-ink-muted">{label}</dt>
      <dd
        className={`mt-auto truncate font-mono text-h3 font-medium tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** A big display number with its unit smaller and muted: **18.4** GB. */
export function BigNumber({ value, unit, className }: { value: ReactNode; unit?: ReactNode; className?: string }) {
  return (
    <p className={`flex items-baseline gap-1.5 font-display leading-none tracking-[-0.03em] text-ink ${className ?? "text-[2.75rem]"}`}>
      <span className="font-bold tabular-nums">{value}</span>
      {unit && <span className="font-display text-h2 text-ink-muted">{unit}</span>}
    </p>
  );
}
