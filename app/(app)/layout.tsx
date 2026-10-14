"use client";

import type { ReactNode } from "react";
import { currentRepoKey } from "@/lib/session";
import { useSession } from "@/lib/session/useSession";
import NavBar from "../components/NavBar";
import PeopleScanner from "../components/people/PeopleScanner";

/**
 * Shell for the tabbed screens (Photos, Albums, Upload, Settings). The NavBar lives
 * here rather than in each page so it stays mounted across tab switches and its
 * active-tab animation plays. Each screen scrolls inside its own container
 * (app/components/library/ScrollArea), never the window.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <div className="fixed inset-0 flex flex-col bg-bg pl-safe pr-safe sm:flex-row">
      <NavBar repoLabel={currentRepoKey(session) ?? undefined} />
      <div className="relative min-h-0 flex-1">{children}</div>
      <PeopleScanner />
    </div>
  );
}
