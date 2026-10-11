"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequiredSession } from "@/app/components/useRequiredSession";
import AlbumClient from "./AlbumClient";

// /albums/view?id=<album id>: the static export can't prerender one page per album.
function AlbumView() {
  const albumId = useSearchParams().get("id") ?? "";
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <AlbumClient key={albumId} repoOwner={session.owner} repoName={session.repo} albumId={albumId} />;
}

export default function AlbumPage() {
  return (
    <Suspense fallback={null}>
      <AlbumView />
    </Suspense>
  );
}
