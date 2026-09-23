import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaRecord, deleteMedia } from "@/lib/media";

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

/**
 * Single-item delete (see docs/ARCHITECTURE.md Section 7): the item is
 * removed from manifest/media-index.json, so the gallery grid and viewer
 * both stop showing it, and its metadata/<id>.json file is removed from the
 * repo tree entirely, but the underlying chunk objects are left alone (see
 * lib/media.deleteMedia's doc comment for why). The gallery's multi-select
 * toolbar uses DELETE /api/media (this same underlying function, batched)
 * for deleting more than one item at once.
 */
export async function DELETE(
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

  const result = await deleteMedia(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    [params.id]
  );
  if (result.deletedIds.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, commitSha: result.commitSha, deletedIds: result.deletedIds });
}
