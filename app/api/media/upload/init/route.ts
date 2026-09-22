import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { findMissingChunkHashes } from "@/lib/media";

export const dynamic = "force-dynamic";

interface InitUploadBody {
  chunkHashes: string[];
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const { chunkHashes } = (await req.json()) as InitUploadBody;
  if (!Array.isArray(chunkHashes)) {
    return NextResponse.json(
      { error: "chunkHashes must be an array" },
      { status: 400 }
    );
  }

  const missing = await findMissingChunkHashes(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    chunkHashes
  );

  return NextResponse.json({ missing });
}
