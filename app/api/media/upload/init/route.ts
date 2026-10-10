import { NextResponse } from "next/server";
import { checkUpload } from "@/lib/media";
import { isChunkHash } from "@/lib/media/validate";
import { ApiError, readJsonBody, withRepo } from "@/lib/session/api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 32,768 chunks × 4 MiB = 128 GiB, far beyond anything a GitHub repo can hold.
const MAX_CHUNKS = 32768;

/** Body { chunkHashes, fileHash? } → { missing, duplicateOf, library }; a duplicate needs no upload, so
 * missing is []. `library` ("owner/repo") lets the phone notice it is now backing up into another repo. */
export const POST = withRepo(
  async (req, { repo }) => {
    const body = await readJsonBody(req);

    const raw = body.chunkHashes;
    if (!Array.isArray(raw) || raw.length > MAX_CHUNKS) {
      throw new ApiError(400, `chunkHashes must be an array of at most ${MAX_CHUNKS} hashes`);
    }
    const chunkHashes = raw.map((hash) => (typeof hash === "string" ? hash.toLowerCase() : hash));
    if (!chunkHashes.every(isChunkHash)) {
      throw new ApiError(400, "chunkHashes must be lowercase sha256 hex digests");
    }

    let fileHash: string | undefined;
    if (body.fileHash !== undefined && body.fileHash !== null) {
      const candidate = typeof body.fileHash === "string" ? body.fileHash.toLowerCase() : body.fileHash;
      if (!isChunkHash(candidate)) throw new ApiError(400, "fileHash must be a sha256 hex digest");
      fileHash = candidate;
    }

    const check = await checkUpload(repo, chunkHashes, fileHash);
    return NextResponse.json({ ...check, library: `${repo.owner}/${repo.repo}` });
  },
  { renew: true }
);
