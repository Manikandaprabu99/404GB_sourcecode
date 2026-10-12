// People found by on-device face grouping (docs/FACES.md). Shared contract: the
// faces builder implements it; Albums and search only use these exports.

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useLibrary } from "@/lib/library/hooks";
import { derivePeople, type PersonDetails } from "./derive";
import { getScanStatus, getServerScanStatus, subscribeScanStatus, type ScanStatus } from "./scanStatus";
import {
  ensureFaces,
  getFacesSnapshot,
  getServerFacesSnapshot,
  subscribeFaces,
  syncFaces,
  type FacesSnapshot,
} from "./store";

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

export type { PersonDetails } from "./derive";
export { derivePeople } from "./derive";

export {
  mergePeople,
  personDistance,
  removeFromPerson,
  renamePerson,
  resolvePerson,
  setPersonCover,
  setPersonHidden,
} from "./store";
export { requestRescan, setScanMobileData, setScanPaused, type ScanStatus } from "./scanStatus";

/** Where a person opens (a query parameter: the static export has no dynamic routes). */
export function personHref(personId: string): string {
  return `/people/view?id=${encodeURIComponent(personId)}`;
}

/** The face grouping state for a library; loads cached people at once and keeps them fresh. */
export function useFaces(repoKey: string): FacesSnapshot {
  const snapshot = useSyncExternalStore(subscribeFaces, getFacesSnapshot, getServerFacesSnapshot);
  useEffect(() => {
    ensureFaces(repoKey);
    void syncFaces();
  }, [repoKey]);
  return snapshot.repoKey === repoKey ? snapshot : { ...getServerFacesSnapshot(), repoKey };
}

/** Everyone grouped so far, hidden and small groups included (People screens, merge picker). */
export function useAllPeople(repoKey: string): { people: PersonDetails[]; ready: boolean } {
  const faces = useFaces(repoKey);
  const library = useLibrary(repoKey);
  const people = useMemo(() => derivePeople(faces.groups, library.items), [faces.groups, library.items]);
  return { people, ready: faces.loaded && library.hydrated };
}

/** People to show (named first, then by photo count); hidden people and tiny groups left out. */
export function usePeople(repoKey: string): { people: Person[]; ready: boolean } {
  const { people, ready } = useAllPeople(repoKey);
  const visible = useMemo(() => people.filter((person) => person.visible), [people]);
  return { people: visible, ready };
}

/** What the face scanner is doing ("Finding people… 1,240 of 8,000 photos"). */
export function useFaceScanStatus(): ScanStatus {
  return useSyncExternalStore(subscribeScanStatus, getScanStatus, getServerScanStatus);
}
