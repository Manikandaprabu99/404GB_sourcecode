import { Fragment, type ReactNode } from "react";

/**
 * A telemetry-style section label (`BACKUP`, `PEOPLE`, `3 MEMORIES`): uppercase mono in
 * ink-muted, optionally with something on the right. A heading (`h2`) unless `as` says otherwise.
 */
export default function SectionLabel({
  as: Tag = "h2",
  id,
  trailing,
  className,
  children,
}: {
  as?: "h2" | "h3" | "p" | "span" | "div";
  id?: string;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (!trailing) {
    return (
      <Tag id={id} className={`telemetry text-ink-muted ${className ?? ""}`}>
        {children}
      </Tag>
    );
  }
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className ?? ""}`}>
      <Tag id={id} className="telemetry min-w-0 truncate text-ink-muted">
        {children}
      </Tag>
      <span className="telemetry shrink-0 text-ink-muted">{trailing}</span>
    </div>
  );
}

/**
 * A line of facts in the telemetry face, joined by faint dots:
 * `<Telemetry items={["12,431 items", "38.2 GB"]} />` → 12,431 ITEMS · 38.2 GB.
 */
export function Telemetry({
  items,
  className,
}: {
  items: ReactNode[];
  className?: string;
}) {
  const shown = items.filter((item) => item !== null && item !== undefined && item !== false && item !== "");
  return (
    <p className={`telemetry min-w-0 truncate text-ink-muted ${className ?? ""}`}>
      {shown.map((item, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <>
              <span aria-hidden="true" className="px-[0.45em] text-ink-faint">
                ·
              </span>
              <span className="sr-only">, </span>
            </>
          )}
          {item}
        </Fragment>
      ))}
    </p>
  );
}
