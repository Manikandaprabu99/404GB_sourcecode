import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AlbumClient from "./AlbumClient";

export const dynamic = "force-dynamic";

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default async function AlbumPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.accessToken) redirect("/");
  if (!session.repoOwner || !session.repoName) redirect("/repos");
  return (
    <AlbumClient repoOwner={session.repoOwner} repoName={session.repoName} albumId={decodeParam(params.id)} />
  );
}
