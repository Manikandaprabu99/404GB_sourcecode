"use client";

import { useRequiredSession } from "@/app/components/useRequiredSession";
import TrashClient from "./TrashClient";

export default function TrashPage() {
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <TrashClient repoOwner={session.owner} repoName={session.repo} />;
}
