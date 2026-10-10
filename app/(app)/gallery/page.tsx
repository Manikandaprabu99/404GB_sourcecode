import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import GalleryClient from "@/app/gallery/GalleryClient";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const session = await getSession();
  if (!session.accessToken) redirect("/");
  if (!session.repoOwner || !session.repoName) redirect("/repos");

  // The index itself loads client-side: IndexedDB cache first, then the sinceSha sync.
  return <GalleryClient repoOwner={session.repoOwner} repoName={session.repoName} />;
}
