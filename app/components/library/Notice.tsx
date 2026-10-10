import type { ReactNode } from "react";
import { AlertIcon, CloudOffIcon } from "./icons";

interface NoticeProps {
  tone?: "warn" | "offline";
  children: ReactNode;
  action?: ReactNode;
}

/** A slim inline banner above a screen's content (sync problems, offline). */
export default function Notice({ tone = "warn", children, action }: NoticeProps) {
  return (
    <div
      role="status"
      className={`mx-3 mb-1 mt-1 flex animate-fade-in items-center gap-3 rounded-xl border px-3.5 py-2.5 text-small sm:mx-6 ${
        tone === "offline"
          ? "border-border bg-surface-2 text-ink-muted"
          : "border-warning/30 bg-warning/10 text-ink"
      }`}
    >
      {tone === "offline" ? (
        <CloudOffIcon size={16} className="shrink-0" />
      ) : (
        <AlertIcon size={16} className="shrink-0 text-warning" />
      )}
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

export const noticeActionClass =
  "shrink-0 rounded-full px-2.5 py-1 text-small font-semibold text-accent transition-colors duration-180 hover:bg-accent/10";
