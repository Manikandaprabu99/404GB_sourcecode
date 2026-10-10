import type { ReactNode } from "react";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-micro font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
      {children}
    </div>
  );
}

export function SettingsRow({
  icon,
  title,
  description,
  trailing,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3.5 px-4 py-3.5">
      {icon && (
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          {icon}
        </span>
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

export const rowButtonClass =
  "inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-small font-semibold text-ink transition-colors duration-180 hover:border-border-strong hover:bg-surface-2 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";
