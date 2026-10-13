import type { ReactNode } from "react";
import { buttonClass } from "@/app/components/ui/Button";
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
      className={`mx-3 mb-1 mt-1 flex animate-fade-in items-center gap-3 rounded-control border py-2 pl-2 pr-2 text-small sm:mx-6 ${
        tone === "offline" ? "border-border/60 bg-surface-2 text-ink-muted" : "border-warning/25 bg-warning/10 text-ink"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-tile ${
          tone === "offline" ? "bg-surface-3 text-ink-muted" : "bg-warning/15 text-warning"
        }`}
      >
        {tone === "offline" ? <CloudOffIcon size={16} /> : <AlertIcon size={16} />}
      </span>
      <p className="min-w-0 flex-1 py-1">{children}</p>
      {action}
    </div>
  );
}

export const noticeActionClass = `${buttonClass({ variant: "ghost", size: "sm" })} shrink-0 !text-accent`;
