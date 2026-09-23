import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { backfillThumbnailIfMissing } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * On-demand server-side thumbnail backfill for one already-stored media
 * item (see lib/media.backfillThumbnailIfMissing for the full explanation).
 *
 * Called by app/gallery/GalleryThumb.tsx: best-effort, fire-and-forget, the
 * first time it renders a placeholder for an image item with no thumbnail —
 * this is what makes items uploaded before this fallback existed (or whose
 * client-side generation failed) self-heal the next time the gallery loads,
 * without the user re-uploading anything.
 *
 * Always resolves 200 (never 500 for a decode/generation failure) — this
 * endpoint's whole point is "try, and if it doesn't work, nothing changes",
 * so the caller only needs to branch on the JSON body's `ok`/`status`, not
 * on HTTP status codes, and a failed attempt is exactly as safe to ignore
 * as thumbnail generation already was at upload time.
 */
export async function POST(
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

  try {
    const result = await backfillThumbnailIfMissing(
      session.accessToken,
      session.repoOwner,
      session.repoName,
      params.id
    );
    return NextResponse.json({
      ok: result.status !== "failed",
      status: result.status,
      thumbnails: result.thumbnails ?? {},
    });
  } catch (err) {
    return NextResponse.json({ ok: false, status: "failed", error: String(err) });
  }
}
