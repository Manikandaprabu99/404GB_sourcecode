import { Fragment, type ReactNode } from "react";

/** A list section heading (13px/600, ink-muted), optionally with something on the right. */
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
      <Tag id={id} className={`text-footnote font-semibold text-ink-muted ${className ?? ""}`}>
        {children}
      </Tag>
    );
  }
  return (
    <div className={`flex items-baseline justify-between gap-3 ${className ?? ""}`}>
      <Tag id={id} className="min-w-0 truncate text-footnote font-semibold text-ink-muted">
        {children}
      </Tag>
      <span className="shrink-0 text-footnote tabular-nums text-ink-muted">{trailing}</span>
    </div>
  );
}

/** Facts joined by faint dots: `<Telemetry items={["12,431 items", "38.2 GB"]} />`. */
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
              <span aria-hidden="true" className="px-[0.4em] text-ink-faint">
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
