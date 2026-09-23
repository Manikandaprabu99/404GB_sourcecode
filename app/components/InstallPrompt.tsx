"use client";

// Phase 5 (PWA): a small, unobtrusive "Install app" button driven by the
// `beforeinstallprompt` event. Renders nothing until the browser actually
// fires that event (so it's naturally absent on browsers that don't
// support installability, e.g. Safari/iOS), and nothing once the app is
// already installed (checked via the `display-mode: standalone` media
// query, which is how an installed/launched PWA window reports itself).
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export default function InstallPrompt({ full }: { full?: boolean } = {}) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setDeferredEvent(null);
      setInstalled(true);
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed || !deferredEvent) return null;

  async function handleInstall() {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    // A BeforeInstallPromptEvent can only be prompted once — the browser
    // will fire a fresh one later if it decides the criteria are met again.
    setDeferredEvent(null);
  }

  return (
    <button
      onClick={handleInstall}
      title="Install 404GB as an app"
      className={
        full
          ? "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-small text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink"
          : "rounded-full border border-border px-3 py-1.5 text-small text-ink-muted transition-all duration-180 ease-out-expo hover:border-border-strong hover:text-ink"
      }
    >
      {full && (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11m0 0 3.5-3.5M12 15l-3.5-3.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
        </svg>
      )}
      Install app
    </button>
  );
}
