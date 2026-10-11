// People found by on-device face grouping (docs/FACES.md). Shared contract: the
// faces builder implements it; Albums and search only use these exports.

/** A face box in the item's 320px-thumbnail space ratios: [x, y, width, height], each 0..1. */
export type FaceBox = [number, number, number, number];

export interface Person {
  id: string;
  /** Null until the user names them. */
  name: string | null;
  /** Library items this person appears in, newest first. */
  mediaIds: string[];
  /** The face shown as their avatar. */
  cover: { mediaId: string; box: FaceBox } | null;
}

/** People to show (named first, then by photo count); hidden people and tiny groups left out. */
export function usePeople(repoKey: string): { people: Person[]; ready: boolean } {
  void repoKey;
  return { people: [], ready: false };
}
