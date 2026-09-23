import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getContentBinary, objectPathForHash } from "@/lib/github";

export const dynamic = "force-dynamic";

// Chunk hashes are always a raw, lowercase hex SHA-256 digest (see
// lib/chunking's sha256Hex / chunkFile — no "sha256:" prefix, unlike
// MediaRecord.hash). This route param is attacker-controlled input used to
// build a repo file path (objectPathForHash), so it's validated against
// that exact shape before touching the filesystem-like GitHub path — never
// passed through un-checked.
const HEX_SHA256 = /^[0-9a-f]{64}$/;

/**
 * Serves exactly ONE content-addressed chunk object (objects/<hash[0:2]>/<hash>),
 * raw, as its own response. This is the read-side counterpart to
 * /api/media/upload/chunk: instead of the server reconstructing an entire
 * multi-chunk file into a single response (which /api/media/object/:id used
 * to do, and which breaks for any file over Vercel's hard 4.5 MB
 * response-body cap — see docs/ARCHITECTURE.md), the client fetches each
 * chunk individually via this route and reassembles them itself
 * (lib/media/reconstructClient.ts). Every chunk is already ≤ the 4 MiB
 * DEFAULT_CHUNK_SIZE, so a single chunk's response is inherently safe under
 * that cap regardless of how large the whole file is.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { hash: string } }
) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const hash = params.hash;
  if (!HEX_SHA256.test(hash)) {
    return NextResponse.json({ error: "invalid chunk hash" }, { status: 400 });
  }

  const bytes = await getContentBinary(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    objectPathForHash(hash)
  );
  if (!bytes) {
    return NextResponse.json({ error: "chunk not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      // Content-addressed and immutable — this hash will only ever map to
      // these exact bytes, so it's safe to cache aggressively.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
