import { NextResponse } from "next/server";
import { listRepos } from "@/lib/github";
import { withAuth } from "@/lib/session/api";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (_req, { accessToken }) => {
  return NextResponse.json({ repos: await listRepos(accessToken) });
});
