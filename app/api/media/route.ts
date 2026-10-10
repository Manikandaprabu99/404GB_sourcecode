import { NextResponse } from "next/server";
import { getHeadSha } from "@/lib/github";
import { deleteMedia, readMediaIndex, setFavorite } from "@/lib/media";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BULK_IDS = 5000;

function parseIds(value: unknown): string[] {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) throw new ApiError(400, "ids (non-empty string array) is required");
  if (ids.length > MAX_BULK_IDS) throw new ApiError(400, `At most ${MAX_BULK_IDS} ids per request`);
  return ids;
}

/** Sync check: one refs call if unchanged since `sinceSha`, else the index read at exactly the returned sha. */
export const GET = withRepo(
  async (req, { repo }) => {
    const sinceSha = req.nextUrl.searchParams.get("sinceSha") || undefined;
    const sha = await getHeadSha(repo.accessToken, repo.owner, repo.repo, repo.branch);
    if (sinceSha && sinceSha === sha) {
      return NextResponse.json({ unchanged: true, sha });
    }
    const index = await readMediaIndex(repo, sha);
    return NextResponse.json({ unchanged: false, sha, index });
  },
  { renew: true }
);

/** Bulk favorite: body { ids, favorite } → { ok, entries }. */
export const PATCH = withRepo(async (req, { repo }) => {
  const body = await readJsonBody(req);
  if (typeof body.favorite !== "boolean") throw new ApiError(400, "favorite (boolean) is required");
  const { entries } = await setFavorite(repo, parseIds(body.ids), body.favorite);
  return NextResponse.json({ ok: true, entries });
});

/** Bulk delete: body { ids } → one commit however many ids (albums updated too). */
export const DELETE = withRepo(async (req, { repo }) => {
  const body = await readJsonBody(req);
  const result = await deleteMedia(repo, parseIds(body.ids));
  return NextResponse.json({ ok: true, commitSha: result.commitSha, deletedIds: result.deletedIds });
});
