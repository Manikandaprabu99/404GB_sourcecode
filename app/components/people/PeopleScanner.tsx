"use client";

import { useEffect } from "react";
import { currentRepoKey } from "@/lib/session";
import { useSession } from "@/lib/session/useSession";

/** Let the screen the user opened load first. */
const START_DELAY_MS = 4000;

/**
 * Finds faces in the background while the app is open (lib/faces/scanner). Mounted once in the
 * tabbed shell; the scanner and the model are loaded only after the first screen settled.
 */
export default function PeopleScanner() {
  const session = useSession();
  const repoKey = session.status === "ready" && session.token ? currentRepoKey(session) : null;

  useEffect(() => {
    if (!repoKey) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      void import("@/lib/faces/scanner").then((scanner) => {
        if (cancelled) return;
        scanner.startFaceScanner(repoKey);
        stop = scanner.stopFaceScanner;
      });
    }, START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop?.();
    };
  }, [repoKey]);

  return null;
}
