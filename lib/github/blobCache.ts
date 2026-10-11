import { sha1HexOf, utf8Bytes } from "./bytes";

// Blob texts by git sha, so a transaction re-reading an unchanged (large) index doesn't
// download it again. A sha names one content and is only learned via an authorized read.
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

export function clearBlobTextCache(): void {
  entries.clear();
  totalChars = 0;
}

/** The sha git assigns to a blob with this UTF-8 content. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = utf8Bytes(text);
  const header = utf8Bytes(`blob ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header);
  all.set(body, header.length);
  return sha1HexOf(all);
}
