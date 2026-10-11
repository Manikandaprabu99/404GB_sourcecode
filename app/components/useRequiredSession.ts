"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@/lib/session";
import { useSession } from "@/lib/session/useSession";

/**
 * The session for a screen that needs a signed-in user (and with `needRepo`, a storage
 * repo), or null while it loads or while leaving for the sign-in screen ("/") or the repo
 * picker. "/" never sends a session without a token anywhere, so the two can't loop.
 */
export function useRequiredSession(needRepo: boolean): Session | null {
  const session = useSession();
  const router = useRouter();
  const target =
    session.status !== "ready"
      ? null
      : !session.token
        ? "/"
        : needRepo && !(session.owner && session.repo)
          ? "/repos"
          : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return session.status === "ready" && !target ? session : null;
}
