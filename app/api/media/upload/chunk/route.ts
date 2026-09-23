import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/session";
import { createBlob, objectPathForHash } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Upload one missing chunk blob (Git Data API createBlob). Returns the blob sha
 * so the client can reference it in the final /commit call without re-sending bytes.
 *
 * The chunk hash travels in the query string and the request body IS the raw
 * chunk bytes (Content-Type: application/octet-stream) — not a JSON envelope
 * with a base64 field. Vercel Functions enforce a hard, non-configurable
 * 4.5 MB cap on inbound request bodies (see
 * https://vercel.com/docs/functions/limitations); base64-encoding on the
 * client inflates payload size by ~33%, which pushed even single chunks
 * (previously 5 MiB raw) over that cap. Raw bytes avoid the inflation
 * entirely. The base64 encoding GitHub's Git Data API requires still happens
 * here, but server-side, on the outbound fetch to GitHub — that leg is not
 * subject to Vercel's inbound-request cap.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.accessToken || !session.repoOwner || !session.repoName) {
    return NextResponse.json(
      { error: "not authenticated or no repo selected" },
      { status: 401 }
    );
  }

  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash) {
    return NextResponse.json({ error: "hash query param is required" }, { status: 400 });
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: "request body must not be empty" }, { status: 400 });
  }

  // Content-addressed storage is only meaningful if the bytes actually hash
  // to the path they're stored under. `hash` is client-supplied, so verify
  // it server-side before committing the blob at objectPathForHash(hash) —
  // otherwise a bug or race that sends mismatched bytes would get committed
  // under a path that lies about its own content, only surfacing (if ever)
  // as a whole-file integrity failure far downstream.
  const actualHash = crypto.createHash("sha256").update(Buffer.from(buf)).digest("hex");
  if (actualHash !== hash) {
    return NextResponse.json(
      { error: "chunk content does not match claimed hash" },
      { status: 400 }
    );
  }

  const base64Content = Buffer.from(buf).toString("base64");

  const sha = await createBlob(
    session.accessToken,
    session.repoOwner,
    session.repoName,
    base64Content
  );

  return NextResponse.json({ hash, sha, path: objectPathForHash(hash) });
}
