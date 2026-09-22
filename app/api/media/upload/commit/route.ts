import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { commitMediaUpload, MediaRecord } from "@/lib/media";

export const dynamic = "force-dynamic";

interface CommitBody {
  record: MediaRecord;
  chunkBlobShas: Record<string, string>;
  thumbnailBlobShas?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const { record, chunkBlobShas, thumbnailBlobShas } =
    (await req.json()) as CommitBody;
  if (!record || !record.id) {
    return NextResponse.json({ error: "record is required" }, { status: 400 });
  }

  const commitSha = await commitMediaUpload(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    {
      record,
      chunkBlobShas: chunkBlobShas ?? {},
      thumbnailBlobShas: thumbnailBlobShas ?? {},
    }
  );

  return NextResponse.json({ ok: true, commitSha, id: record.id });
}
