import { UploadQueue } from "./uploadQueue";

let queue: UploadQueue | null = null;

/** The app-wide upload queue. It outlives page navigation, so uploads keep
 * running (and stay visible) when the user switches tabs. Browser-only. */
export function getUploadQueue(): UploadQueue {
  if (!queue) queue = new UploadQueue();
  return queue;
}
