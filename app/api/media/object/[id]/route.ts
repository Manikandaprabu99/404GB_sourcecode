import crypto from "crypto";
import { NextResponse } from "next/server";
import { MAX_DIRECT_FETCH_BYTES } from "@/lib/chunking";
import { isMediaId, readMediaRecord, reconstructMedia } from "@/lib/media";
import { ApiError, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";

/** A whole hash-verified file in one response, only up to MAX_DIRECT_FETCH_BYTES (Vercel's response cap). */
export const GET = withRepo<{ id: string }>(async (_req, { repo }, params) => {
  const record = isMediaId(params.id) ? await readMediaRecord(repo, params.id) : null;
  if (!record) throw new ApiError(404, "not found");

  if (record.size > MAX_DIRECT_FETCH_BYTES) {
    throw new ApiError(413, "file too large for direct fetch, use chunked reconstruction", "too_large", {
      size: record.size,
      maxDirectFetchBytes: MAX_DIRECT_FETCH_BYTES,
    });
  }

  const buffer = await reconstructMedia(repo, record);
  const actualHash = `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  if (actualHash !== record.hash) {
    throw new ApiError(500, "integrity check failed", "integrity", { expected: record.hash, actual: actualHash });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
});
