import { NextResponse } from "next/server";
import { githubRetryAfterSeconds } from "@/lib/github";
import { backfillThumbnailIfMissing, isMediaId } from "@/lib/media";
import { errorResponse, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** On-demand sharp thumbnails for one image; failures are 200 ok:false, rate limits 429 as everywhere. */
export const POST = withRepo<{ id: string }>(async (_req, { repo }, params) => {
  if (!isMediaId(params.id)) {
    return NextResponse.json({ ok: false, status: "skipped", thumbnails: {} });
  }
  try {
    const result = await backfillThumbnailIfMissing(repo, params.id);
    return NextResponse.json({
      ok: result.status !== "failed",
      status: result.status,
      thumbnails: result.thumbnails ?? {},
    });
  } catch (err) {
    if (githubRetryAfterSeconds(err) !== null) return errorResponse(err);
    return NextResponse.json({ ok: false, status: "failed", thumbnails: {} });
  }
});
