import type { ReactNode } from "react";
import IconButton, { iconButtonClass } from "@/app/components/ui/IconButton";
import { BackIcon, SelectIcon } from "./icons";

/** The bar's Select action: an icon tile on phones, with its label from `sm` (as on Photos). */
export function SelectButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Select"
      title="Select"
      className={`${iconButtonClass({ variant: "tile", size: 40 })} sm:w-auto sm:gap-2 sm:px-3`}
    >
      <SelectIcon size={18} />
      <span className="hidden text-small font-medium sm:inline">Select</span>
    </button>
  );
}

/**
 * The sticky bar of a screen inside MediaLibraryView (an album, a category, Trash, a person),
 * docs/DESIGN.md › Page header: back button and actions; once the screen has scrolled a
 * little it turns into the compact blurred bar and the name fades in at 17px. The large
 * title lives in SubScreenTitle below it, where a long album name can wrap.
 */
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
      className={`border-b pt-safe transition-[background-color,border-color] duration-200 ease-out-expo sm:pt-0 ${
        collapsed ? "glass-bg border-border/60" : "border-transparent bg-bg"
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-2 sm:px-6">
        <IconButton variant="ghost" label={backLabel} onClick={onBack} className="sm:-ml-2">
          <BackIcon size={20} />
        </IconButton>
        <p
          aria-hidden="true"
          className={`min-w-0 flex-1 truncate pl-2 text-h3 text-ink transition-[opacity,transform] duration-250 ease-out-expo ${
            collapsed ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"
          }`}
        >
          {title}
        </p>
        {actions && <div className="flex shrink-0 items-center gap-2 pl-1">{actions}</div>}
      </div>
    </div>
  );
}

/** The large title under the bar (scrolls away with the content): a display h1 that may wrap
 * to two lines, a telemetry line, and room for something before it (a person's face). */
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
    <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 pb-4 pt-1 sm:gap-5 sm:px-6">
      {leading}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title}
        {telemetry && <div className="flex min-h-[14px] items-center">{telemetry}</div>}
        {children}
      </div>
    </div>
  );
}

/** The h1 of SubScreenTitle: display type, up to two lines. */
export const subScreenHeadingClass = "line-clamp-2 break-words font-display text-h1 text-ink";
