import { NextResponse } from "next/server";
import { getContentBinary, objectPathForHash } from "@/lib/github";
import { isChunkHash } from "@/lib/media/validate";
import { ApiError, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";

/** One raw chunk object (≤ 4 MiB, under Vercel's response cap); clients reassemble whole files. */
export const GET = withRepo<{ hash: string }>(async (_req, { repo }, params) => {
  // The hash becomes a repo path, so it must be exactly a lowercase sha256 hex digest.
  if (!isChunkHash(params.hash)) throw new ApiError(400, "invalid chunk hash");

  const bytes = await getContentBinary(repo.accessToken, repo.owner, repo.repo, objectPathForHash(params.hash));
  if (!bytes) throw new ApiError(404, "chunk not found");

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      // Content-addressed and immutable: this hash only ever maps to these bytes.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});
