"use client";

import GalleryClient from "@/app/gallery/GalleryClient";
import { useRequiredSession } from "@/app/components/useRequiredSession";

export default function GalleryPage() {
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  // The index itself loads client-side: IndexedDB cache first, then the head-sha sync.
  return <GalleryClient repoOwner={session.owner} repoName={session.repo} />;
}
