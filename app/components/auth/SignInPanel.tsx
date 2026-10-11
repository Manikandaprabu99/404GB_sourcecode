"use client";

import { useState } from "react";
import { deviceFlowAvailable } from "@/lib/auth/deviceFlow";
import { GithubIcon } from "@/app/components/library/icons";
import DeviceSignIn from "./DeviceSignIn";
import TokenSignIn from "./TokenSignIn";
import { primaryAuthButtonClass, secondaryAuthButtonClass, textAuthButtonClass } from "./shared";

type Mode = "choose" | "device" | "token";

const cardClass =
  "w-full rounded-2xl border border-border bg-surface/80 p-5 shadow-soft backdrop-blur sm:p-6 animate-fade-in-up";

/**
 * The ways to sign in: "Sign in with GitHub" (Device Flow, only inside the app and only
 * when this build has an OAuth client id) and a pasted personal access token (everywhere).
 * Rendered after the session has loaded, so it never hydrates against prerendered HTML.
 */
export default function SignInPanel({ lastLogin }: { lastLogin: string | null }) {
  const [deviceFlow] = useState(deviceFlowAvailable);
  const [mode, setMode] = useState<Mode>(deviceFlow ? "choose" : "token");

  const hint = lastLogin ? (
    <p className="mb-4 text-center text-small text-ink-muted">
      Last signed in as <span className="font-mono text-ink">@{lastLogin}</span>
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
