import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaIndex, deleteMedia } from "@/lib/media";
import { getDefaultBranch, getHeadSha } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Section 11 (Sync Strategy): the client sends the last commit SHA it has
 * cached in IndexedDB as `sinceSha`. We check the repo's actual HEAD via the
 * cheap git refs API (one call, no tree listing) and only re-fetch
 * manifest/media-index.json when it doesn't match — so a gallery reload
 * with nothing new to show costs one small refs lookup, not a full
 * media-index fetch every time.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const sinceSha = req.nextUrl.searchParams.get("sinceSha") || undefined;

  // The branch is cached on the session after repo selection (see
  // /api/repos/init); fall back to resolving + caching it here for sessions
  // created before that field existed.
  let branch = session.repoBranch;
  if (!branch) {
    branch = await getDefaultBranch(
      session.accessToken,
      session.repoOwner,
      session.repoName
    );
    session.repoBranch = branch;
    await session.save();
  }

  const headSha = await getHeadSha(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    branch
  );

  if (sinceSha && sinceSha === headSha) {
    // Repo hasn't changed since the client's cache was last synced — the
    // client already has everything it needs in IndexedDB, so skip the
    // media-index fetch entirely.
    return NextResponse.json({ unchanged: true, sha: headSha });
  }

  const index = await readMediaIndex(
    session.accessToken,
    session.repoOwner,
    session.repoName
  );
  return NextResponse.json({ unchanged: false, sha: headSha, media: index });
}

interface BulkDeleteBody {
  ids?: unknown;
}

/**
 * Multi-select bulk delete: the gallery's selection toolbar sends every
 * checked id here in one request so it costs one commit total instead of
 * one per item (see lib/media.deleteMedia). A single-item delete (the
 * viewer's trash button) uses DELETE /api/media/:id instead — same
 * underlying function either way.
 */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as BulkDeleteBody;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids (non-empty string array) is required" }, { status: 400 });
  }

  const result = await deleteMedia(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    ids
  );
  return NextResponse.json({ ok: true, commitSha: result.commitSha, deletedIds: result.deletedIds });
}
