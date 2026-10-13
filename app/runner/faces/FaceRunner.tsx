"use client";

import { useEffect, useState } from "react";
import StatusScreen, { primaryButtonClass } from "@/app/components/ui/StatusScreen";
import { isRunnerHost } from "@/lib/faces/runnerHost";

/**
 * Starts the run when the Android app's host is there; in a browser it only says what the
 * page is for. The note is in the exported HTML, so a browser shows it at once; with a host
 * it goes away as the run starts (nobody sees that WebView anyway).
 */
export default function FaceRunner() {
  const [hosted, setHosted] = useState(false);

  useEffect(() => {
    const host = window.FaceRunnerHost;
    if (!isRunnerHost(host)) return;
    setHosted(true);
    import("@/lib/faces/runner").then(
      (runner) => runner.startFaceRunner(host),
      () => {
        try {
          host.finished(JSON.stringify({ checked: 0, reason: "The People page couldn't load its code" }));
        } catch {
          // The host closes the page on its own.
        }
      }
    );
  }, []);

  if (hosted) return null;
  return (
    <StatusScreen
      eyebrow="People runner"
      title="Nothing to do here"
      message="The 404GB Android app opens this page while your phone charges, to find people in your photos."
    >
      {/* A plain link: nothing here should prefetch. */}
      <a href="/" className={primaryButtonClass}>
        Open 404GB
      </a>
    </StatusScreen>
  );
}
