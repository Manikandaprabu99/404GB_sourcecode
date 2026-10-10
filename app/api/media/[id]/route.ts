import { NextResponse } from "next/server";
import { deleteMedia, isMediaId, readMediaRecord, setFavorite } from "@/lib/media";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { id: string };

function mediaId(params: Params): string {
  if (!isMediaId(params.id)) throw new ApiError(404, "not found");
  return params.id;
}

export const GET = withRepo<Params>(async (_req, { repo }, params) => {
  const record = await readMediaRecord(repo, mediaId(params));
  if (!record) throw new ApiError(404, "not found");
  return NextResponse.json({ media: record });
});

/** Body { favorite: boolean } → { ok, entry }. */
export const PATCH = withRepo<Params>(async (req, { repo }, params) => {
  const body = await readJsonBody(req);
  if (typeof body.favorite !== "boolean") throw new ApiError(400, "favorite (boolean) is required");
  const { entries } = await setFavorite(repo, [mediaId(params)], body.favorite);
  if (entries.length === 0) throw new ApiError(404, "not found");
  return NextResponse.json({ ok: true, entry: entries[0] });
});

/** Single-item delete; same one-commit path as the bulk DELETE /api/media. */
export const DELETE = withRepo<Params>(async (_req, { repo }, params) => {
  const result = await deleteMedia(repo, [mediaId(params)]);
  if (result.deletedIds.length === 0) throw new ApiError(404, "not found");
  return NextResponse.json({ ok: true, commitSha: result.commitSha, deletedIds: result.deletedIds });
});
