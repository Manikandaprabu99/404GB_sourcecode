"use client";

// "Install app" button for the PWA. The browser fires `beforeinstallprompt` only
// once per page load, usually before any screen showing this button mounts, so
// app/layout.tsx captures it into window.__404gbInstallPrompt and announces
// changes with a "404gb:installprompt" event; this component just reads it.
// Renders nothing where installing isn't possible (Safari/iOS, the Android app)
// or once the app is installed.
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type InstallWindow = Window & { __404gbInstallPrompt?: BeforeInstallPromptEvent | null };

const CHANGE_EVENT = "404gb:installprompt";

function capturedEvent(): BeforeInstallPromptEvent | null {
  return (window as InstallWindow).__404gbInstallPrompt ?? null;
}

function setCapturedEvent(event: BeforeInstallPromptEvent | null) {
  (window as InstallWindow).__404gbInstallPrompt = event;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function InstallIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11m0 0 3.5-3.5M12 15l-3.5-3.5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export default function InstallPrompt({ full }: { full?: boolean } = {}) {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    const sync = () => setDeferredEvent(capturedEvent());
    // Fallback for pages served without the capture script (e.g. an older cached shell).
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      if (capturedEvent() !== e) setCapturedEvent(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredEvent(null);
      setInstalled(true);
    };

    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed || !deferredEvent) return null;

  async function handleInstall() {
    const event = capturedEvent();
    if (!event) return;
    // A prompt can be shown only once; the browser fires a fresh event if it allows another.
    setCapturedEvent(null);
    await event.prompt();
    await event.userChoice.catch(() => undefined);
  }

  return (
    <button
      type="button"
      onClick={() => void handleInstall()}
      title="Install 404GB as an app"
      className={
        full
          ? "flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-small text-ink-muted transition-colors duration-180 hover:bg-surface-2 hover:text-ink animate-fade-in"
          : "inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-small text-ink-muted transition-all duration-180 ease-out-expo hover:border-border-strong hover:text-ink active:scale-95 animate-fade-in"
      }
    >
      <InstallIcon />
      Install app
    </button>
  );
}
