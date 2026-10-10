import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import AlbumsClient from "./AlbumsClient";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const session = await getSession();
  if (!session.accessToken) redirect("/");
  if (!session.repoOwner || !session.repoName) redirect("/repos");
  return <AlbumsClient repoOwner={session.repoOwner} repoName={session.repoName} />;
}
