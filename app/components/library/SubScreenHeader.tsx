import type { ReactNode } from "react";
import IconButton, { iconButtonClass } from "@/app/components/ui/IconButton";
import { BackIcon, SelectIcon } from "./icons";

/** The bar's Select action: a round icon on phones, a labelled pill from `sm`. */
export function SelectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Select"
      title="Select"
      className={`${iconButtonClass({ variant: "tile", size: 40 })} sm:w-auto sm:gap-2 sm:px-4`}
    >
      <SelectIcon size={18} />
      <span className="hidden text-callout font-semibold sm:inline">Select</span>
    </button>
  );
}

/** The sticky bar of an album, category, Trash or person screen: back and actions; once
 * scrolled it turns into the compact glass bar with the centred name. */
export function SubScreenBar({
  backLabel,
  onBack,
  title,
  collapsed,
  actions,
}: {
  backLabel: string;
  onBack: () => void;
  /** Shown in the compact bar (decorative: the large title is the heading). */
  title: ReactNode;
  collapsed: boolean;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`border-b pt-safe transition-[background-color,border-color] duration-240 ease-out-expo sm:pt-0 ${
        collapsed ? "glass-bg border-[rgb(var(--hairline))]" : "border-transparent bg-bg"
      }`}
    >
      <div className="relative mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-2 sm:h-16 sm:px-6 lg:px-8">
        <IconButton variant="tile" label={backLabel} onClick={onBack}>
          <BackIcon size={20} />
        </IconButton>
        <span className="flex-1" />
        <p
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-1/2 max-w-[52%] -translate-x-1/2 truncate text-headline text-ink transition-[opacity,transform] duration-240 ease-out-expo ${
            collapsed ? "-translate-y-1/2 opacity-100" : "-translate-y-[30%] opacity-0"
          }`}
        >
          {title}
        </p>
        {actions && <div className="flex shrink-0 items-center gap-2 pl-1">{actions}</div>}
      </div>
    </div>
  );
}

/** The large title under the bar (scrolls away): up to two lines, a facts line, and room
 * for something before it (a person's face). */
export function SubScreenTitle({
  title,
  telemetry,
  leading,
  children,
}: {
  title: ReactNode;
  telemetry?: ReactNode;
  leading?: ReactNode;
  /** Under the telemetry line (e.g. a button). */
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 pb-4 pt-1 sm:gap-5 sm:px-6 lg:px-8">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title}
        {telemetry && <div className="flex min-h-[18px] items-center">{telemetry}</div>}
        {children}
      </div>
    </div>
  );
}

/** The h1 of SubScreenTitle: the large-title role, up to two lines. */
export const subScreenHeadingClass = "line-clamp-2 break-words text-large-title text-ink lg:text-large-title-desktop";
