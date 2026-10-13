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
        <p role="alert" className="w-full rounded-control bg-danger/10 px-4 py-3 text-small text-ink dark:text-danger">
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
      <p className="telemetry text-ink-muted">Enter this code on GitHub</p>
      {/* docs/DESIGN.md › Sign-in: each character in its own tile, filling in one by one. */}
      <button
        type="button"
        onClick={() => void copyText(code.userCode).then(setCopied)}
        aria-label={`Sign-in code ${code.userCode.split("").join(" ")}. Tap to copy.`}
        className="flex items-center gap-1 rounded-control p-1 transition-transform duration-180 ease-out-expo active:scale-[0.97]"
      >
        {code.userCode.split("").map((char, i) =>
          char === "-" ? (
            <span key={i} aria-hidden="true" className="w-2.5 text-center font-mono text-[1.75rem] leading-none text-ink-muted">
              -
            </span>
          ) : (
            <span
              key={i}
              className="flex h-12 w-8 animate-fade-in-up items-center justify-center rounded-tile bg-surface-2 font-mono text-[1.75rem] font-semibold leading-none text-ink shadow-inset-hairline dark:bg-surface-3"
              style={{ animationDelay: `${i * 35}ms` }}
            >
              {char}
            </span>
          )
        )}
      </button>
      <p className={`flex items-center gap-1.5 text-small ${copied ? "text-success" : "text-ink-muted"}`}>
        {copied && <CheckIcon size={14} />}
        {copied ? "Copied to the clipboard" : "Tap the code to copy it"}
      </p>
      <button type="button" onClick={openGitHub} className={primaryAuthButtonClass}>
        Open GitHub
        <ExternalIcon size={16} />
      </button>
      <p role="status" className="flex items-center gap-2 text-small text-ink-muted">
        <TileGlyph state="busy" className="text-accent" />
        Waiting for you to approve on GitHub…
      </p>
      <button type="button" onClick={onCancel} className={textAuthButtonClass}>
        Cancel
      </button>
    </div>
  );
}
