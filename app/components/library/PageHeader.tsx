import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** e.g. a back button, shown before the title. */
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

/** Sticky screen header. On phones it is the top bar, so it pads for the status bar. */
export default function PageHeader({ title, subtitle, leading, actions, children }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-bg/90 pt-safe backdrop-blur-xl sm:pt-0">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-2 sm:px-6">
        {leading}
        <div className={`min-w-0 flex-1 ${leading ? "pl-1" : "pl-2 sm:pl-0"}`}>
          <h1 className="truncate text-h3 font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="truncate text-micro text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
