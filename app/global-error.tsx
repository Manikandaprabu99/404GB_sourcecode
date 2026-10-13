"use client";

// Replaces the root layout when it crashes, so it brings its own <html>/<body> and styles.
import "./globals.css";
import { useEffect } from "react";
import StatusScreen, { primaryButtonClass, secondaryButtonClass } from "./components/ui/StatusScreen";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[404gb] app error", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <StatusScreen
          eyebrow="Error · App failed to load"
          title="404GB ran into a problem"
          message="Something went wrong while loading the app. Your photos are safe."
        >
          <button type="button" onClick={reset} className={primaryButtonClass}>
            Try again
          </button>
          <a href="/" className={secondaryButtonClass}>
            Reload 404GB
          </a>
        </StatusScreen>
      </body>
    </html>
  );
}
