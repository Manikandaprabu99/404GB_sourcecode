"use client";

import { useState } from "react";
import { deviceFlowAvailable } from "@/lib/auth/deviceFlow";
import { GithubIcon } from "@/app/components/library/icons";
import DeviceSignIn from "./DeviceSignIn";
import TokenSignIn from "./TokenSignIn";
import { primaryAuthButtonClass, secondaryAuthButtonClass, textAuthButtonClass } from "./shared";

type Mode = "choose" | "device" | "token";

// A card on the page (docs/DESIGN.md › Cards); no glass: blur is for fixed chrome only.
const cardClass =
  "w-full rounded-card bg-surface p-5 shadow-soft animate-fade-in-up dark:border dark:border-border/60 dark:shadow-none sm:p-6";

/**
 * The ways to sign in: "Sign in with GitHub" (Device Flow, only inside the app and only
 * when this build has an OAuth client id) and a pasted personal access token (everywhere).
 * Rendered after the session has loaded, so it never hydrates against prerendered HTML.
 */
export default function SignInPanel({ lastLogin }: { lastLogin: string | null }) {
  const [deviceFlow] = useState(deviceFlowAvailable);
  const [mode, setMode] = useState<Mode>(deviceFlow ? "choose" : "token");

  const hint = lastLogin ? (
    <p className="mb-4 flex items-center justify-center gap-2 text-small text-ink-muted">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-signal" />
      <span>
        Last signed in as <span className="font-mono text-ink">@{lastLogin}</span>
      </span>
    </p>
  ) : null;

  if (mode === "device") {
    return (
      <div key="device" className={cardClass}>
        <DeviceSignIn onCancel={() => setMode("choose")} onUseToken={() => setMode("token")} />
      </div>
    );
  }

  if (mode === "token") {
    return (
      <div key="token" className={cardClass}>
        {hint}
        <TokenSignIn autoFocus={deviceFlow} />
        {deviceFlow && (
          <div className="mt-3 flex justify-center">
            <button type="button" onClick={() => setMode("choose")} className={textAuthButtonClass}>
              Back
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div key="choose" className={`${cardClass} flex flex-col gap-3`}>
      {hint}
      <button type="button" onClick={() => setMode("device")} className={primaryAuthButtonClass}>
        <GithubIcon size={18} />
        <span className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
          Sign in with GitHub
        </span>
      </button>
      <button type="button" onClick={() => setMode("token")} className={secondaryAuthButtonClass}>
        Use a personal access token
      </button>
    </div>
  );
}
