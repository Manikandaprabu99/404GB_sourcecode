"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getServerSession, getSession, loadSession, subscribeSession, type Session } from "./index";

/** The GitHub session; "loading" during prerendering and until the stored session is read. */
export function useSession(): Session {
  const session = useSyncExternalStore(subscribeSession, getSession, getServerSession);
  useEffect(() => {
    void loadSession();
  }, []);
  return session;
}
