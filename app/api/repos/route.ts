import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { listRepos } from "@/lib/github";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.accessToken) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const repos = await listRepos(session.accessToken);
  return NextResponse.json({ repos });
}
