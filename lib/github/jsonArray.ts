/** A manifest that isn't a JSON array; writing over it as "empty" would wipe the library. */
export class CorruptJsonError extends Error {
  constructor(readonly path: string) {
    super(`${path} in your repo isn't a valid JSON array — fix or restore it on GitHub`);
    this.name = "CorruptJsonError";
  }
}

/** Parses a manifest file; a missing or blank file is an empty array. */
export function parseJsonArray<T>(path: string, text: string | null): T[] {
  if (text === null || text.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CorruptJsonError(path);
  }
  if (!Array.isArray(parsed)) throw new CorruptJsonError(path);
  return parsed as T[];
}

/** One entry per line: compact, still readable on GitHub, and diffs line by line. */
export function serializeJsonArray(items: readonly unknown[]): string {
  if (items.length === 0) return "[]\n";
  return `[\n${items.map((item) => `  ${JSON.stringify(item)}`).join(",\n")}\n]\n`;
}
