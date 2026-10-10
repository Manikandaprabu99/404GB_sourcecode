import type { ReactNode } from "react";
import { getSession } from "@/lib/session";
import NavBar from "../components/NavBar";

export const dynamic = "force-dynamic";

/**
 * Shell for the tabbed screens (Photos, Albums, Settings). The NavBar lives
 * here rather than in each page so it stays mounted across tab switches and its
 * active-tab animation plays. Each screen scrolls inside its own container
 * (app/components/library/ScrollArea), never the window.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const repoLabel =
    session.repoOwner && session.repoName ? `${session.repoOwner}/${session.repoName}` : undefined;

  return (
    <div className="fixed inset-0 flex flex-col bg-bg pl-safe pr-safe">
      <NavBar repoLabel={repoLabel} />
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}
