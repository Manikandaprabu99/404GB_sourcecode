// Typed error for "we could not produce a thumbnail" so callers (see
// lib/upload/uploadQueue.ts) can treat this class of failure as non-fatal —
// distinct from real data-loss failures like a chunk upload or commit
// erroring out — without resorting to matching on error message text.
export class ThumbnailDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ThumbnailDecodeError";
  }
}
