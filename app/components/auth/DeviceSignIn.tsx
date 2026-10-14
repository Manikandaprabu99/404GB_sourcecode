"use client";

import { useEffect, useState } from "react";
import { Browser } from "@capacitor/browser";
import {
  DeviceFlowError,
  pollForToken,
  requestDeviceCode,
  type DeviceCode,
} from "@/lib/auth/deviceFlow";
import { checkToken, TokenError } from "@/lib/auth/token";
import { signIn } from "@/lib/session";
import { CheckIcon, ExternalIcon } from "@/app/components/library/icons";
import { TileGlyph } from "@/app/components/ui/StatusBadge";
import { AuthSpinner, primaryAuthButtonClass, secondaryAuthButtonClass, textAuthButtonClass } from "./shared";

type Phase =
  | { kind: "requesting" }
  | { kind: "waiting"; code: DeviceCode }
  | { kind: "finishing" }
  | { kind: "error"; message: string; disabled: boolean };

/** Copies `text`; true when it worked (the async API can be missing in a WebView). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * "Sign in with GitHub" in the app: shows a one-time code (copied to the clipboard), opens
 * github.com/login/device in the in-app browser and waits until the user approves it there.
 */
export default function DeviceSignIn({ onCancel, onUseToken }: { onCancel: () => void; onUseToken: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "requesting" });
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setPhase({ kind: "requesting" });
    setCopied(false);
    void (async () => {
      try {
        const code = await requestDeviceCode();
        if (cancelled) return;
        setPhase({ kind: "waiting", code });
        setCopied(await copyText(code.userCode));
        const token = await pollForToken(code, controller.signal);
        if (cancelled) return;
        setPhase({ kind: "finishing" });
        Browser.close().catch(() => {});
        const { login } = await checkToken(token);
        await signIn(token, login);
      } catch (err) {
        if (cancelled || isAbort(err)) return;
        setPhase({
          kind: "error",
          message:
            err instanceof DeviceFlowError || err instanceof TokenError
              ? err.message
              : "Couldn't sign in with GitHub. Try again.",
          disabled: err instanceof DeviceFlowError && err.code === "disabled",
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  if (phase.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-4 text-center animate-fade-in">
        <p role="alert" className="w-full rounded-control bg-danger/10 px-4 py-3 text-callout font-normal text-ink dark:text-danger">
          {phase.message}
        </p>
        {!phase.disabled && (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={primaryAuthButtonClass}>
            Try again
          </button>
        )}
        <button type="button" onClick={onUseToken} className={phase.disabled ? primaryAuthButtonClass : secondaryAuthButtonClass}>
          Use a token instead
        </button>
        <button type="button" onClick={onCancel} className={textAuthButtonClass}>
          Back
        </button>
      </div>
    );
  }

  if (phase.kind !== "waiting") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-6 text-callout font-normal text-ink-muted animate-fade-in">
        <AuthSpinner size={22} />
        {phase.kind === "requesting" ? "Getting a sign-in code…" : "Signing you in…"}
      </div>
    );
  }

  const { code } = phase;
  const openGitHub = () => {
    Browser.open({ url: code.verificationUri }).catch(() => window.open(code.verificationUri, "_blank", "noopener"));
  };

  return (
    <div className="flex flex-col items-center gap-4 text-center animate-fade-in-up">
      <p className="text-footnote font-semibold text-ink-muted">Enter this code on GitHub</p>
      {/* The code in a large monospace card; tap to copy. */}
      <button
        type="button"
        onClick={() => void copyText(code.userCode).then(setCopied)}
        aria-label={`Sign-in code ${code.userCode.split("").join(" ")}. Tap to copy.`}
        className="pressable flex w-full items-center justify-center gap-3 rounded-[18px] bg-surface-2 px-4 py-5 shadow-inset-hairline dark:bg-ink/[0.06]"
      >
        <span className="font-mono text-[2rem] font-semibold leading-none tracking-[0.12em] text-ink">{code.userCode}</span>
        <span aria-hidden="true" className={`flex h-8 w-8 items-center justify-center rounded-full ${copied ? "bg-success/15 text-success" : "bg-accent-soft text-accent-text"}`}>
          {copied ? <CheckIcon size={16} strokeWidth={2.6} /> : <CopyGlyph />}
        </span>
      </button>
      <p className={`flex items-center gap-1.5 text-footnote ${copied ? "text-success" : "text-ink-muted"}`}>
        {copied && <CheckIcon size={14} />}
        {copied ? "Copied to the clipboard" : "Tap the code to copy it"}
      </p>
      <button type="button" onClick={openGitHub} className={primaryAuthButtonClass}>
        Open GitHub
        <ExternalIcon size={16} />
      </button>
      <p role="status" className="flex items-center gap-2 text-footnote text-ink-muted">
        <TileGlyph state="busy" className="text-accent-text" />
        Waiting for you to approve on GitHub…
      </p>
      <button type="button" onClick={onCancel} className={textAuthButtonClass}>
        Cancel
      </button>
    </div>
  );
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="3" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  );
}
