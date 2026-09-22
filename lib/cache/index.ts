// Phase 4 — Local Cache (ARCHITECTURE.md Section 13) public surface.

export { repoKeyFor } from "./db";
export type {
  CachedMediaRecord,
  CachedThumbnailRecord,
  SyncStateRecord,
} from "./db";

export {
  getCachedMediaIndex,
  applyMediaDiff,
  replaceCachedMediaIndex,
  diffMediaIndex,
} from "./mediaCache";
export type { MediaDiff } from "./mediaCache";

export { getSyncState, setSyncState } from "./syncState";

export { getCachedThumbnail, putCachedThumbnail } from "./thumbnailCache";

export { loadThumbnailObjectUrl } from "./thumbnailLoader";
