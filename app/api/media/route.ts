import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaIndex } from "@/lib/media";
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
