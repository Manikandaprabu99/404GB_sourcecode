import { NextResponse } from "next/server";
import { isMediaId, setTakenAtIfMissing } from "@/lib/media";
import { normalizeDate } from "@/lib/media/validate";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Params = { id: string };

/**
 * Body { takenAt } → { ok, changed, entry }. Sets the capture date only when the
 * item has none (init reports this as duplicateNeedsDate); POST because the
 * Android client's HttpURLConnection can't send PATCH.
 */
export const POST = withRepo<Params>(
  async (req, { repo }, params) => {
    if (!isMediaId(params.id)) throw new ApiError(404, "not found");
    const body = await readJsonBody(req);
    const takenAt = normalizeDate(body.takenAt);
    if (!takenAt) throw new ApiError(400, "takenAt must be a plausible ISO 8601 date");
    const result = await setTakenAtIfMissing(repo, params.id, takenAt);
    if (!result.entry) throw new ApiError(404, "not found");
    return NextResponse.json({ ok: true, changed: result.changed, entry: result.entry });
  },
  { renew: true }
);
