"use client";

import { useRequiredSession } from "@/app/components/useRequiredSession";
import AlbumsClient from "./AlbumsClient";

export default function AlbumsPage() {
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <AlbumsClient repoOwner={session.owner} repoName={session.repo} />;
}
