"use client";

import { useEffect } from "react";
import Link from "next/link";
import StatusScreen, { primaryButtonClass, secondaryButtonClass } from "./components/ui/StatusScreen";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[404gb] page error", error);
  }, [error]);

  return (
    <StatusScreen
      eyebrow="Oops"
      title="Something went wrong"
      message="This screen hit a snag. Your photos are safe — try again, or head back to your library."
    >
      <button type="button" onClick={reset} className={primaryButtonClass}>
        Try again
      </button>
      <Link href="/gallery" className={secondaryButtonClass}>
        Go to your photos
      </Link>
    </StatusScreen>
  );
}
