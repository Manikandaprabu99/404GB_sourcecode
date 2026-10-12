"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequiredSession } from "@/app/components/useRequiredSession";
import PersonClient from "@/app/components/people/PersonClient";

// /people/view?id=<person id>: the static export can't prerender one page per person.
function PersonView() {
  const personId = useSearchParams().get("id") ?? "";
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <PersonClient key={personId} repoOwner={session.owner} repoName={session.repo} personId={personId} />;
}

export default function PersonPage() {
  return (
    <Suspense fallback={null}>
      <PersonView />
    </Suspense>
  );
}
