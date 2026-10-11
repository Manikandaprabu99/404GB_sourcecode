"use client";

import { useRequiredSession } from "@/app/components/useRequiredSession";
import SettingsClient from "./SettingsClient";

export default function SettingsPage() {
  const session = useRequiredSession(false);
  if (!session) return null;
  return <SettingsClient githubLogin={session.login} repoOwner={session.owner} repoName={session.repo} />;
}
