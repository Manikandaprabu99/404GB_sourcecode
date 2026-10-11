"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { Browser } from "@capacitor/browser";
import { checkToken, NEW_TOKEN_URL, TokenError } from "@/lib/auth/token";
import { isNativeApp } from "@/lib/native/platform";
import { signIn } from "@/lib/session";
import { ExternalIcon } from "@/app/components/library/icons";
import { AuthSpinner, primaryAuthButtonClass } from "./shared";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

/** Opens github.com in the app's in-app browser (a plain new tab in a browser). */
export function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  if (!isNativeApp()) return;
  event.preventDefault();
  Browser.open({ url }).catch(() => window.open(url, "_blank", "noopener"));
}

/** Sign-in with a pasted personal access token, checked against GitHub before it is kept. */
export default function TokenSignIn({ autoFocus = false }: { autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, login } = await checkToken(value);
      await signIn(token, login);
      // The home screen moves on as soon as the session has a token.
    } catch (err) {
      setError(err instanceof TokenError ? err.message : "Couldn't sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 text-left">
      <div>
        <label htmlFor="github-token" className="text-body font-semibold text-ink">
          Personal access token
        </label>
        <p id="github-token-hint" className="mt-1 text-small text-ink-muted">
          Create a token with the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-micro">repo</code>{" "}
          scope and paste it here. It stays on this device and is only ever sent to GitHub.
        </p>
      </div>

      <a
        href={NEW_TOKEN_URL}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => openExternal(event, NEW_TOKEN_URL)}
        className="group inline-flex h-11 w-fit items-center gap-2 rounded-full border border-border px-4 text-small font-semibold text-accent transition-colors duration-180 hover:border-border-strong hover:bg-surface-2"
      >
        Create a token on GitHub
        <ExternalIcon size={15} className="transition-transform duration-180 ease-out-expo group-hover:-translate-y-px group-hover:translate-x-px" />
      </a>

      <div className="relative">
        <input
          id="github-token"
          name="github-token"
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          autoFocus={autoFocus}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="ghp_… or github_pat_…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "github-token-hint github-token-error" : "github-token-hint"}
          disabled={busy}
          className={`h-12 w-full rounded-xl border bg-surface-2 pl-3.5 pr-12 font-mono text-small text-ink outline-none transition-colors duration-180 placeholder:text-ink-faint focus:border-accent disabled:opacity-70 ${
            error ? "border-danger" : "border-border"
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide token" : "Show token"}
          aria-pressed={visible}
          className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition-colors duration-180 hover:bg-surface-3 hover:text-ink"
        >
          <EyeIcon off={visible} />
        </button>
      </div>

      {error && (
        <p id="github-token-error" role="alert" className="text-small text-danger animate-fade-in">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className={primaryAuthButtonClass}>
        {busy && <AuthSpinner />}
        {busy ? "Checking…" : "Sign in"}
      </button>

      <p className="text-micro text-ink-faint">
        Fine-grained tokens work too: give them Contents (read and write) and Metadata (read) access to your photo repo.
      </p>
    </form>
  );
}
