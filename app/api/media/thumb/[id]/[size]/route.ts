import { NextResponse } from "next/server";
import { getContentBinary } from "@/lib/github";
import { isMediaId, thumbnailPath } from "@/lib/media";
import { ApiError, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";

const ALLOWED_SIZES = new Set(["320", "800", "1600"]);

/** Serves one stored thumbnail webp (a single small object, no reconstruction). */
export const GET = withRepo<{ id: string; size: string }>(async (_req, { repo }, params) => {
  if (!ALLOWED_SIZES.has(params.size)) throw new ApiError(400, "invalid size");
  if (!isMediaId(params.id)) throw new ApiError(404, "not found");

  const bytes = await getContentBinary(
    repo.accessToken,
    repo.owner,
    repo.repo,
    thumbnailPath(params.id, params.size)
  );
  if (!bytes) throw new ApiError(404, "not found");

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400, immutable",
    },
  });
});
