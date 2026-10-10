import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session.accessToken) redirect("/");
  return (
    <SettingsClient
      githubLogin={session.githubLogin ?? null}
      repoOwner={session.repoOwner ?? null}
      repoName={session.repoName ?? null}
    />
  );
}
