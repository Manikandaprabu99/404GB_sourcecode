import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { readMediaRecord, reconstructMedia } from "@/lib/media";
import { MAX_DIRECT_FETCH_BYTES } from "@/lib/chunking";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * Reconstructs the full media file from its chunks (server-side, since only
 * the server holds the GitHub token) and streams the bytes back to the
 * browser. Verifies the reassembled bytes against the stored whole-file hash.
 *
 * Only safe for files under MAX_DIRECT_FETCH_BYTES — see the guard below and
 * docs/ARCHITECTURE.md's "Vercel Functions Body-Size Cap" section. Anything
 * bigger must go through GET /api/media/:id + client-side chunked
 * reconstruction (lib/media/reconstructClient.ts), which
 * app/gallery/MediaViewer.tsx already selects based on this same threshold —
 * this check is defense in depth in case that client-side check is ever
 * bypassed or wrong (e.g. a stale record.size, a direct API call).
 */
export async function GET(
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

  const record = await readMediaRecord(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    params.id
  );
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (record.size > MAX_DIRECT_FETCH_BYTES) {
    return NextResponse.json(
      {
        error: "file too large for direct fetch, use chunked reconstruction",
        size: record.size,
        maxDirectFetchBytes: MAX_DIRECT_FETCH_BYTES,
      },
      { status: 413 }
    );
  }

  const buffer = await reconstructMedia(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    record
  );

  const actualHash = `sha256:${crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex")}`;
  if (actualHash !== record.hash) {
    return NextResponse.json(
      { error: "integrity check failed", expected: record.hash, actual: actualHash },
      { status: 500 }
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": record.mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
