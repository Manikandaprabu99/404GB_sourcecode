import { NextResponse } from "next/server";
import { getHeadSha } from "@/lib/github";
import { deleteMedia, readMediaIndex, setFavorite, type MediaIndexEntry } from "@/lib/media";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BULK_IDS = 5000;
// Vercel caps function responses at 4.5 MB (about 12,000 entries), so a big
// library comes back in pages, all read at the same commit.
const PAGE_BYTES = 3 * 1024 * 1024;
const COMMIT_SHA = /^[0-9a-f]{40}$/;

function pageOf(index: MediaIndexEntry[], offset: number) {
  let bytes = 0;
  let end = offset;
  while (end < index.length) {
    const size = JSON.stringify(index[end]).length + 1;
    if (end > offset && bytes + size > PAGE_BYTES) break;
    bytes += size;
    end++;
  }
  return { entries: index.slice(offset, end), nextOffset: end < index.length ? end : null };
}

function parseIds(value: unknown): string[] {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0) throw new ApiError(400, "ids (non-empty string array) is required");
  if (ids.length > MAX_BULK_IDS) throw new ApiError(400, `At most ${MAX_BULK_IDS} ids per request`);
  return ids;
}

/**
 * Sync check: one refs call if unchanged since `sinceSha`, else the first page of the index read at
 * exactly the returned sha. While `nextOffset` isn't null, fetch `?sha=<sha>&offset=<nextOffset>`.
 */
export const GET = withRepo(
  async (req, { repo }) => {
    const params = req.nextUrl.searchParams;
    const pinned = params.get("sha");
    if (pinned) {
      if (!COMMIT_SHA.test(pinned)) throw new ApiError(400, "sha must be a commit sha");
      const offset = Number.parseInt(params.get("offset") ?? "0", 10);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, "offset must be a whole number");
      const index = await readMediaIndex(repo, pinned);
      const page = pageOf(index, offset);
      return NextResponse.json({
        unchanged: false,
        sha: pinned,
        index: page.entries,
        nextOffset: page.nextOffset,
        total: index.length,
      });
    }

    const sinceSha = params.get("sinceSha") || undefined;
    const sha = await getHeadSha(repo.accessToken, repo.owner, repo.repo, repo.branch);
    if (sinceSha && sinceSha === sha) {
      return NextResponse.json({ unchanged: true, sha });
    }
    const index = await readMediaIndex(repo, sha);
    const page = pageOf(index, 0);
    return NextResponse.json({
      unchanged: false,
      sha,
      index: page.entries,
      nextOffset: page.nextOffset,
      total: index.length,
    });
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
