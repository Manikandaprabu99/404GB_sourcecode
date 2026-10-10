import { NextResponse } from "next/server";
import { createAlbum, listAlbums } from "@/lib/albums/server";
import { readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = withRepo(async (_req, { repo }) => {
  return NextResponse.json({ albums: await listAlbums(repo) });
});

/** Body { name, mediaIds? } → { album }. Unknown media ids are ignored. */
export const POST = withRepo(async (req, { repo }) => {
  const body = await readJsonBody(req);
  const album = await createAlbum(repo, { name: body.name, mediaIds: body.mediaIds });
  return NextResponse.json({ album });
});
