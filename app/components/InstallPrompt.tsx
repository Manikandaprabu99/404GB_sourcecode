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

export default function InstallPrompt() {
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
      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:text-neutral-100"
      title="Install 404GB as an app"
    >
      Install app
    </button>
  );
}
