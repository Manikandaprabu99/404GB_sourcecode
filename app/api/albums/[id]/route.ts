import { NextResponse } from "next/server";
import { deleteAlbum, updateAlbum } from "@/lib/albums/server";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { id: string };

/** Body { name?, addMediaIds?, removeMediaIds?, coverId? } → { album }. */
export const PATCH = withRepo<Params>(async (req, { repo }, params) => {
  const body = await readJsonBody(req);
  const album = await updateAlbum(repo, params.id, {
    name: body.name,
    addMediaIds: body.addMediaIds,
    removeMediaIds: body.removeMediaIds,
    coverId: body.coverId,
  });
  return NextResponse.json({ album });
});

/** Deletes the album only; its photos and videos stay in the library. */
export const DELETE = withRepo<Params>(async (_req, { repo }, params) => {
  if (!(await deleteAlbum(repo, params.id))) throw new ApiError(404, "Album not found");
  return NextResponse.json({ ok: true });
});
