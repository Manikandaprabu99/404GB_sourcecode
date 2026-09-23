import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { commitMediaUpload, backfillThumbnailIfMissing, MediaRecord } from "@/lib/media";

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

  // Client-side thumbnail generation is best-effort (lib/thumbnails) and can
  // fail for real images a browser canvas just can't decode. When it came
  // back empty for an image, try again server-side with `sharp` — which
  // decodes far more real-world images reliably — right now, on the same
  // request, before the upload flow reports "done". This is itself
  // best-effort: a failure here must not fail the upload, which already
  // fully succeeded via the commit above (see lib/media.backfillThumbnailIfMissing's
  // doc comment for why it always resolves rather than throwing).
  let backfilledThumbnails: Record<string, string> | undefined;
  const hasNoThumbnail = !record.thumbnails || Object.keys(record.thumbnails).length === 0;
  if (record.mimeType?.startsWith("image/") && hasNoThumbnail) {
    try {
      const result = await backfillThumbnailIfMissing(
        session.accessToken,
        session.repoOwner,
        session.repoName,
        record.id
      );
      if (result.status === "created") backfilledThumbnails = result.thumbnails;
    } catch {
      // Best-effort — the upload itself already committed successfully above.
    }
  }

  return NextResponse.json({
    ok: true,
    commitSha,
    id: record.id,
    ...(backfilledThumbnails ? { thumbnails: backfilledThumbnails } : {}),
  });
}
