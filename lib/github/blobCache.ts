import { createHash } from "crypto";

// Blob texts by git sha; a sha names one content and is only learned via an authorized read.
const MAX_TOTAL_CHARS = 48 * 1024 * 1024;
const MAX_ENTRY_CHARS = 16 * 1024 * 1024;

const entries = new Map<string, string>();
let totalChars = 0;

export function getCachedBlobText(sha: string): string | undefined {
  const text = entries.get(sha);
  if (text === undefined) return undefined;
  // Refresh recency: Map iteration order is insertion order.
  entries.delete(sha);
  entries.set(sha, text);
  return text;
}

export function putCachedBlobText(sha: string, text: string): void {
  if (text.length > MAX_ENTRY_CHARS || entries.has(sha)) return;
  entries.set(sha, text);
  totalChars += text.length;
  for (const [oldSha, oldText] of entries) {
    if (totalChars <= MAX_TOTAL_CHARS) break;
    entries.delete(oldSha);
    totalChars -= oldText.length;
  }
}

/** The sha git assigns to a blob with this UTF-8 content. */
export function gitBlobSha(text: string): string {
  const body = Buffer.from(text, "utf-8");
  return createHash("sha1")
    .update(`blob ${body.length}\0`)
    .update(body)
    .digest("hex");
}
