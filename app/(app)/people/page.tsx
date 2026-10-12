"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequiredSession } from "@/app/components/useRequiredSession";
import PeopleClient from "@/app/components/people/PeopleClient";

// /people (and /people?hidden=1 from Settings): everyone found in the library.
function PeopleView() {
  const showHidden = useSearchParams().get("hidden") === "1";
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <PeopleClient repoOwner={session.owner} repoName={session.repo} showHidden={showHidden} />;
}

export default function PeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeopleView />
    </Suspense>
  );
}
