"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRequiredSession } from "@/app/components/useRequiredSession";
import CategoryClient from "./CategoryClient";

// /albums/category?id=<category id>: the static export can't prerender one page per category.
function CategoryView() {
  const categoryId = useSearchParams().get("id") ?? "";
  const session = useRequiredSession(true);
  if (!session?.owner || !session.repo) return null;
  return <CategoryClient key={categoryId} repoOwner={session.owner} repoName={session.repo} categoryId={categoryId} />;
}

export default function CategoryPage() {
  return (
    <Suspense fallback={null}>
      <CategoryView />
    </Suspense>
  );
}
