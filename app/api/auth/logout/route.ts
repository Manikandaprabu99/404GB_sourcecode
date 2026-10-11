import { NextResponse } from "next/server";
import { revokeGitHubToken } from "@/lib/auth/oauth";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Signs this device out and deletes its GitHub token (frees one of GitHub's 10 per user). */
export async function POST() {
  const session = await getSession();
  const token = session.accessToken;
  session.destroy();
  if (token) await revokeGitHubToken(token);
  return NextResponse.json({ ok: true });
}
