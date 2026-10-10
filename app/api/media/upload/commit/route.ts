import { NextResponse } from "next/server";
import { githubRetryAfterSeconds } from "@/lib/github";
import { backfillThumbnailIfMissing, commitMediaUpload } from "@/lib/media";
import { readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Body { record, chunkBlobShas, thumbnailBlobShas? } → { ok, id, duplicate, commitSha, entry, thumbnails? }. */
export const POST = withRepo(
  async (req, { repo }) => {
    const body = await readJsonBody(req);
    const result = await commitMediaUpload(repo, {
      record: body.record,
      chunkBlobShas: body.chunkBlobShas,
      thumbnailBlobShas: body.thumbnailBlobShas,
    });

    let thumbnails = result.record?.thumbnails;
    let entry = result.entry;
    const stored = result.record;
    const needsThumbnails = !!stored && stored.mimeType.startsWith("image/") && !entry.thumb;
    if (needsThumbnails) {
      // The browser couldn't make previews; best-effort sharp retry (the upload is already committed).
      try {
        const backfill = await backfillThumbnailIfMissing(repo, stored.id, stored);
        if (backfill.thumbnails && Object.keys(backfill.thumbnails).length > 0) {
          thumbnails = backfill.thumbnails;
          if (thumbnails["320"]) entry = { ...entry, thumb: thumbnails["320"] };
        }
      } catch (err) {
        if (githubRetryAfterSeconds(err) === null) console.warn("[404gb] thumbnail backfill failed", err);
      }
    }

    return NextResponse.json({
      ok: true,
      id: result.id,
      duplicate: result.duplicate,
      commitSha: result.commitSha,
      entry,
      ...(thumbnails && Object.keys(thumbnails).length > 0 ? { thumbnails } : {}),
    });
  },
  { renew: true }
);
