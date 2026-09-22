import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaIndex } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const index = await readMediaIndex(
    session.accessToken,
    session.repoOwner,
    session.repoName
  );
  return NextResponse.json({ media: index });
}
