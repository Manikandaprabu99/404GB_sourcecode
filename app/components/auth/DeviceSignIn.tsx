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
        <p role="alert" className="text-small text-danger">
          {phase.message}
        </p>
        {!phase.disabled && (
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={primaryAuthButtonClass}>
            Try again
          </button>
        )}
        <button type="button" onClick={onUseToken} className={phase.disabled ? primaryAuthButtonClass : secondaryAuthButtonClass}>
          Use a personal access token
        </button>
        <button type="button" onClick={onCancel} className={textAuthButtonClass}>
          Back
        </button>
      </div>
    );
  }

  if (phase.kind !== "waiting") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-6 text-small text-ink-muted animate-fade-in">
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
      <p className="text-small text-ink-muted">Enter this code on GitHub to sign in</p>
      <button
        type="button"
        onClick={() => void copyText(code.userCode).then(setCopied)}
        aria-label={`Sign-in code ${code.userCode.split("").join(" ")}. Tap to copy.`}
        className="rounded-2xl border border-border-strong bg-surface-2 px-6 py-3.5 font-mono text-[1.75rem] font-semibold leading-none tracking-[0.2em] text-ink shadow-inset-hairline transition-transform duration-180 ease-out-expo active:scale-[0.97]"
      >
        {code.userCode}
      </button>
      <p className={`flex items-center gap-1.5 text-micro ${copied ? "text-success" : "text-ink-faint"}`}>
        {copied && <CheckIcon size={13} />}
        {copied ? "Copied to the clipboard" : "Tap the code to copy it"}
      </p>
      <button type="button" onClick={openGitHub} className={primaryAuthButtonClass}>
        Open GitHub
        <ExternalIcon size={16} />
      </button>
      <p role="status" className="flex items-center gap-2 text-small text-ink-muted">
        <AuthSpinner size={14} />
        Waiting for you to approve on GitHub…
      </p>
      <button type="button" onClick={onCancel} className={textAuthButtonClass}>
        Cancel
      </button>
    </div>
  );
}
