// People derived from the grouping and the library: which photos each person is in (newest
// first, Trash left out), their avatar face, and who is shown. Pure, so it's unit-tested.

import type { MediaIndexEntry } from "@/lib/media/types";
import { MIN_PHOTOS_TO_SHOW } from "./cluster";
import type { Person } from "./people";
import type { FaceGroup } from "./store";

/** A person with everything the People screens need. */
export interface PersonDetails extends Person {
  hidden: boolean;
  /** Shown in People (named, or in enough photos) — hidden people excepted. */
  visible: boolean;
}

function coverOf(group: FaceGroup, order: ReadonlyMap<string, number>): Person["cover"] {
  const chosen = group.cover ? group.faces.find((f) => f.key === group.cover && order.has(f.mediaId)) : undefined;
  if (chosen) return { mediaId: chosen.mediaId, box: chosen.box };
  let best: FaceGroup["faces"][number] | null = null;
  let bestScore = -1;
  for (const face of group.faces) {
    if (!order.has(face.mediaId)) continue;
    // A confident, big (sharp) face makes the best avatar.
    const score = face.score * Math.sqrt(face.box[2] * face.box[3]);
    if (score > bestScore || (score === bestScore && best && face.key < best.key)) {
      best = face;
      bestScore = score;
    }
  }
  return best ? { mediaId: best.mediaId, box: best.box } : null;
}

/** Every grouped person with their photos in the library (Trash and deleted items left out). */
export function derivePeople(groups: readonly FaceGroup[], items: readonly MediaIndexEntry[]): PersonDetails[] {
  const order = new Map<string, number>();
  items.forEach((item, index) => {
    if (!item.trashedAt) order.set(item.id, index);
  });
  const people: PersonDetails[] = [];
  for (const group of groups) {
    const mediaIds = Array.from(new Set(group.faces.map((f) => f.mediaId).filter((id) => order.has(id))));
    if (mediaIds.length === 0) continue;
    mediaIds.sort((a, b) => order.get(a)! - order.get(b)!);
    people.push({
      id: group.id,
      name: group.name,
      mediaIds,
      cover: coverOf(group, order),
      hidden: group.hidden,
      visible: !group.hidden && (group.name !== null || mediaIds.length >= MIN_PHOTOS_TO_SHOW),
    });
  }
  // Named first, then by how many photos they're in.
  people.sort(
    (a, b) =>
      Number(b.name !== null) - Number(a.name !== null) ||
      b.mediaIds.length - a.mediaIds.length ||
      (a.name ?? "").localeCompare(b.name ?? "") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  return people;
}
