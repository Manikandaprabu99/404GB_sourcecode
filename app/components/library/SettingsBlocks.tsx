import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/app/components/ui/Button";
import SectionLabel from "@/app/components/ui/SectionLabel";
import { ChevronRightIcon } from "./icons";

// Grouped inset lists (docs/DESIGN.md › Cards / SettingsBlocks): 52px rows with a 30px badge.

export type IconTone =
  | "neutral"
  | "accent"
  | "accent-2"
  | "warning"
  | "danger"
  | "success"
  | "teal"
  | "sky"
  | "indigo"
  | "pink"
  | "orange";

// Solid badges with a white glyph, the same in both themes (decorative).
const ICON_TONES: Record<IconTone, string> = {
  neutral: "bg-[rgb(142_148_160)] text-white",
  accent: "bg-accent text-accent-ink",
  "accent-2": "bg-[rgb(139_92_246)] text-white",
  warning: "bg-[rgb(245_158_11)] text-white",
  danger: "bg-[rgb(239_68_68)] text-white",
  success: "bg-[rgb(16_185_129)] text-white",
  teal: "bg-[rgb(20_184_166)] text-white",
  sky: "bg-[rgb(14_165_233)] text-white",
  indigo: "bg-[rgb(99_102_241)] text-white",
  pink: "bg-[rgb(236_72_153)] text-white",
  orange: "bg-[rgb(249_115_22)] text-white",
};

/** The 30px rounded-square icon badge of rows and cards. */
export function IconTile({ tone = "neutral", children, className }: { tone?: IconTone; children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] [&_svg]:h-[18px] [&_svg]:w-[18px] ${ICON_TONES[tone]} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

export const cardClass = "card rounded-card";

export function SettingsSection({ title, children, trailing }: { title: string; children: ReactNode; trailing?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionLabel className="px-4" trailing={trailing}>
        {title}
      </SectionLabel>
      {children}
    </section>
  );
}

/** A grouped list; hairlines between rows start after the icon badge. */
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`settings-card overflow-hidden ${cardClass} ${className ?? ""}`}>{children}</div>;
}

export function SettingsRow({
  icon,
  iconTone,
  title,
  description,
  value,
  trailing,
  href,
  onClick,
  chevron,
  children,
}: {
  icon?: ReactNode;
  iconTone?: IconTone;
  title: ReactNode;
  description?: ReactNode;
  /** A short value before the chevron ("Sapphire", "On"). */
  value?: ReactNode;
  trailing?: ReactNode;
  /** Makes the row a link (with a chevron). */
  href?: string;
  /** Makes the row a button (or runs before a link's navigation). */
  onClick?: () => void;
  chevron?: boolean;
  children?: ReactNode;
}) {
  const showChevron = chevron ?? Boolean(href || onClick);
  const body = (
    <>
      {icon && (
        <span className="flex shrink-0 items-start pt-[11px]">
          <IconTile tone={iconTone}>{icon}</IconTile>
        </span>
      )}
      <span className="settings-row-body flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-3 pr-4">
        <span className="min-w-0 flex-1">
          <span className="block text-body font-medium text-ink">{title}</span>
          {description && <span className="mt-0.5 block text-footnote text-ink-muted">{description}</span>}
          {children}
        </span>
        {value !== undefined && <span className="shrink-0 text-body tabular-nums text-ink-muted">{value}</span>}
        {trailing && <span className="shrink-0">{trailing}</span>}
        {showChevron && <ChevronRightIcon size={16} strokeWidth={2.2} className="shrink-0 text-ink-faint" />}
      </span>
    </>
  );
  const classes = `settings-row flex w-full items-stretch gap-3.5 pl-4 text-left ${icon ? "" : "settings-row-plain"}`;
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={`${classes} transition-colors duration-160 hover:bg-ink/[0.03] active:bg-ink/[0.06]`}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${classes} transition-colors duration-160 hover:bg-ink/[0.03] active:bg-ink/[0.06]`}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

/** Small secondary button for rows (36px, 44px hit area). */
export const rowButtonClass = buttonClass({ variant: "secondary", size: "sm" });

/** Two columns of cards (three from `sm`), e.g. Settings › Library. */
export function BentoGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${className ?? ""}`}>{children}</div>;
}

/** A card with an icon badge, a title and a value: a link, a button, or a plain card. */
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
      <span className="mt-auto flex min-w-0 flex-col gap-0.5 pt-4">
        <span className="truncate text-body font-semibold text-ink">{title}</span>
        {value !== undefined && <span className="truncate text-footnote tabular-nums text-ink-muted">{value}</span>}
      </span>
      {children}
    </>
  );
  const classes = `flex min-h-[116px] min-w-0 flex-col items-start p-4 text-left ${cardClass} ${interactive ? "pressable" : ""} ${className ?? ""}`;
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

/** A grid of stats: label above, value below. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={`grid grid-cols-2 gap-2 ${className ?? ""}`}>{children}</dl>;
}

export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "danger" | "warning" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-control bg-surface-2 px-3.5 py-3 dark:bg-ink/[0.05]">
      <dt className="text-footnote text-ink-muted">{label}</dt>
      <dd
        className={`mt-auto truncate text-headline tabular-nums ${
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/** A big number with its unit smaller and muted: **18.4** GB. */
export function BigNumber({ value, unit, className }: { value: ReactNode; unit?: ReactNode; className?: string }) {
  return (
    <p className={`flex items-baseline gap-1.5 leading-none tracking-[-0.03em] text-ink ${className ?? "text-[2.5rem]"}`}>
      <span className="font-bold tabular-nums">{value}</span>
      {unit && <span className="text-title text-ink-muted">{unit}</span>}
    </p>
  );
}
