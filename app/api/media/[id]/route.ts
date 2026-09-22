import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaRecord } from "@/lib/media";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const record = await readMediaRecord(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    params.id
  );
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ media: record });
}
