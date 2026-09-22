import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getContentBinary } from "@/lib/github";
import { thumbnailPath } from "@/lib/media";

export const dynamic = "force-dynamic";

const ALLOWED_SIZES = new Set(["320", "800", "1600"]);

/**
 * Serves a single thumbnail webp directly (no chunk reconstruction needed —
 * thumbnails are stored as one small object per size per the data model).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; size: string } }
) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  if (!ALLOWED_SIZES.has(params.size)) {
    return NextResponse.json({ error: "invalid size" }, { status: 400 });
  }

  const bytes = await getContentBinary(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    thumbnailPath(params.id, params.size)
  );
  if (!bytes) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
}
