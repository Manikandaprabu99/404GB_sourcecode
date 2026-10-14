"use client";

import { useState } from "react";
import { deviceFlowAvailable } from "@/lib/auth/deviceFlow";
import { GithubIcon } from "@/app/components/library/icons";
import DeviceSignIn from "./DeviceSignIn";
import TokenSignIn from "./TokenSignIn";
import { primaryAuthButtonClass, textAuthButtonClass } from "./shared";

type Mode = "choose" | "device" | "token";

// A card on the page; no glass: blur is for fixed chrome only.
const cardClass = "card w-full rounded-card p-5 animate-fade-in-up sm:p-6";

/** "Sign in with GitHub" (Device Flow: app builds with a client id) or a pasted token (everywhere). */
export default function SignInPanel({ lastLogin }: { lastLogin: string | null }) {
  const [deviceFlow] = useState(deviceFlowAvailable);
  const [mode, setMode] = useState<Mode>(deviceFlow ? "choose" : "token");

  const hint = lastLogin ? (
    <p className="mb-4 flex items-center justify-center gap-2 text-footnote text-ink-muted">
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span>
        Last signed in as <span className="font-semibold text-ink">@{lastLogin}</span>
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
      <button type="button" onClick={() => setMode("token")} className={textAuthButtonClass}>
        Use a token instead
      </button>
    </div>
  );
}
