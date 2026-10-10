"use client";

import type { MouseEvent } from "react";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { createVerifierPair, VERIFIER_STORAGE_KEY } from "@/lib/auth/nativeAuth";

const LOGIN_PATH = "/api/auth/github/login";

export default function ConnectGitHubButton() {
  async function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!Capacitor.isNativePlatform()) return;
    event.preventDefault();
    try {
      const { verifier, challenge } = await createVerifierPair();
      localStorage.setItem(VERIFIER_STORAGE_KEY, verifier);
      await Browser.open({ url: `${window.location.origin}${LOGIN_PATH}?challenge=${challenge}` });
    } catch {
      // App builds from before the Browser plugin was added: old redirect flow.
      window.location.href = LOGIN_PATH;
    }
  }

  return (
    <a
      href={LOGIN_PATH}
      onClick={handleClick}
      className="group inline-flex items-center gap-2.5 rounded-full bg-ink px-6 py-3.5 text-body font-medium text-bg shadow-soft transition-all duration-180 ease-out-expo hover:-translate-y-0.5 hover:shadow-glow-accent active:translate-y-0 active:scale-[0.98]"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.59.24 2.77.12 3.06.74.8 1.18 1.83 1.18 3.09 0 4.43-2.69 5.4-5.26 5.69.42.36.78 1.08.78 2.17 0 1.57-.01 2.83-.01 3.22 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12c0-6.35-5.15-11.5-11.5-11.5Z" />
      </svg>
      <span className="transition-transform duration-180 ease-out-expo group-hover:translate-x-0.5">
        Connect GitHub
      </span>
    </a>
  );
}
