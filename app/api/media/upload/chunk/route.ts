import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createBlob, objectPathForHash } from "@/lib/github";

export const dynamic = "force-dynamic";

interface UploadChunkBody {
  hash: string;
  base64Content: string;
}

/** Upload one missing chunk blob (Git Data API createBlob). Returns the blob sha
 * so the client can reference it in the final /commit call without re-sending bytes. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const { hash, base64Content } = (await req.json()) as UploadChunkBody;
  if (!hash || !base64Content) {
    return NextResponse.json(
      { error: "hash and base64Content are required" },
      { status: 400 }
    );
  }

  const sha = await createBlob(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    base64Content
  );

  return NextResponse.json({ hash, sha, path: objectPathForHash(hash) });
}
