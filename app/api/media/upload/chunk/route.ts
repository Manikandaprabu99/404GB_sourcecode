import crypto from "crypto";
import { NextResponse } from "next/server";
import { DEFAULT_CHUNK_SIZE } from "@/lib/chunking";
import { createBlob, objectPathForHash } from "@/lib/github";
import { isChunkHash } from "@/lib/media/validate";
import { ApiError, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";

/** One raw chunk or thumbnail (≤ 4 MiB, no base64 under Vercel's 4.5 MB cap) → its Git blob sha. */
export const POST = withRepo(
  async (req, { repo }) => {
    const hash = req.nextUrl.searchParams.get("hash")?.toLowerCase() ?? "";
    if (!isChunkHash(hash)) {
      throw new ApiError(400, "hash query param must be the sha256 hex digest of the body");
    }

    const body = Buffer.from(await req.arrayBuffer());
    if (body.length === 0) throw new ApiError(400, "request body must not be empty");
    if (body.length > DEFAULT_CHUNK_SIZE) {
      throw new ApiError(413, `chunks must be at most ${DEFAULT_CHUNK_SIZE} bytes`);
    }

    // Content addressing only holds if the bytes really hash to the claimed path.
    const actualHash = crypto.createHash("sha256").update(body).digest("hex");
    if (actualHash !== hash) {
      throw new ApiError(400, "chunk content does not match claimed hash", "hash_mismatch");
    }

    const sha = await createBlob(repo.accessToken, repo.owner, repo.repo, body.toString("base64"));
    return NextResponse.json({ hash, sha, path: objectPathForHash(hash) });
  },
  { renew: true }
);
