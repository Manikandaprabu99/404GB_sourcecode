// Grouping faces into people (docs/FACES.md). Pure and deterministic: the same doc plus the
// same operations give the same result on every device, so this device's view (last known
// faces.json + its pending operations) and the commit (faces.json at the head + the same
// operations, inside the race-safe transaction) agree, and concurrent writers merge by
// replaying their operations on top of each other's commits.
//
// Embeddings are unit vectors (doc.ts); "distance" is the Euclidean distance between them
// (0 = identical, 2 = opposite). A face joins the nearest person whose centroid (normalized
// mean of their faces) is within ASSIGN_DISTANCE, never a person already in the same photo;
// otherwise it starts a new person. After each photo, people that drifted within
// MERGE_DISTANCE of each other are merged unless the user's names or corrections say otherwise.

import {
  cleanName,
  dequantizeEmbedding,
  EMBEDDING_DIMS,
  faceKey,
  FACE_MODEL,
  normalizeBox,
  parseFaceKey,
  type FaceRecord,
  type FacesDoc,
  type MediaFaces,
  type PersonRecord,
} from "./doc";
import type { FaceBox } from "./people";

/** Max distance from a person's centroid for a new face to join them. */
export const ASSIGN_DISTANCE = 0.34;
/** Max distance between two people's centroids for them to be merged automatically. */
export const MERGE_DISTANCE = 0.3;
/** After "not this person", the face only moves to someone this close (else it stands alone). */
export const REASSIGN_DISTANCE = 0.3;
/** Unnamed people are shown once they are in this many photos (named people always). */
export const MIN_PHOTOS_TO_SHOW = 3;

const dotFor = (distance: number) => 1 - (distance * distance) / 2;
const ASSIGN_DOT = dotFor(ASSIGN_DISTANCE);
const MERGE_DOT = dotFor(MERGE_DISTANCE);
const REASSIGN_DOT = dotFor(REASSIGN_DISTANCE);

export interface ScannedFace {
  box: FaceBox;
  score: number;
  emb: string;
}

/** Everything a device can change, replayed on the latest faces.json at commit time. */
export type FacesOp =
  | { op: "scan"; media: string; faces: ScannedFace[] }
  | { op: "name"; person: string; name: string | null }
  | { op: "hide"; person: string; hidden: boolean }
  | { op: "merge"; people: string[]; into: string }
  | { op: "reject"; person: string; faces: string[] }
  | { op: "cover"; person: string; face: string };

export interface PersonGroup {
  id: string;
  name: string | null;
  hidden: boolean;
  /** The user's chosen avatar face, if any. */
  cover: string | null;
  /** Face keys ("<mediaId>#<index>"). */
  faces: string[];
}

interface Cluster {
  id: string;
  sum: Float64Array;
  centroid: Float32Array;
  faces: Set<string>;
  /** Faces per media id (a person is in a photo at most once unless the user merged). */
  media: Map<string, number>;
}

/** Dot product of two embeddings (unrolled: this is the hot loop of grouping). */
function dot(a: Float32Array, b: Float32Array): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i += 4) {
    s0 += a[i] * b[i];
    s1 += a[i + 1] * b[i + 1];
    s2 += a[i + 2] * b[i + 2];
    s3 += a[i + 3] * b[i + 3];
  }
  return s0 + s1 + s2 + s3;
}

/** Distance between two unit vectors from their dot product. */
export function distanceFromDot(d: number): number {
  return Math.sqrt(Math.max(0, 2 - 2 * d));
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A stable person id derived from `seed` (the first face's key), so every device picks the same one. */
export function personIdFor(seed: string): string {
  const a = fnv1a(seed, 0x811c9dc5).toString(36).padStart(7, "0");
  const b = fnv1a(seed, 0x2f6b1d37).toString(36).padStart(7, "0");
  return `person_${a}${b}`;
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").toLocaleLowerCase() === (b ?? "").toLocaleLowerCase();
}

export class FacesState {
  model: string;
  private readonly people: Map<string, PersonRecord>;
  private readonly media: Map<string, MediaFaces>;
  private readonly vectors: Map<string, Float32Array>;
  private readonly clusters: Map<string, Cluster>;
  private readonly faceRoot: Map<string, string>;

  private constructor(
    model: string,
    people: Map<string, PersonRecord>,
    media: Map<string, MediaFaces>,
    vectors: Map<string, Float32Array>,
    clusters: Map<string, Cluster>,
    faceRoot: Map<string, string>
  ) {
    this.model = model;
    this.people = people;
    this.media = media;
    this.vectors = vectors;
    this.clusters = clusters;
    this.faceRoot = faceRoot;
  }

  static empty(model = FACE_MODEL): FacesState {
    return new FacesState(model, new Map(), new Map(), new Map(), new Map(), new Map());
  }

  /** Builds the working state of a parsed faces.json (records are copied, never shared). */
  static fromDoc(doc: FacesDoc): FacesState {
    const state = FacesState.empty(doc.model);
    for (const [id, p] of doc.people) state.people.set(id, { ...p });
    state.breakAliasCycles();
    for (const [id, m] of doc.media) {
      state.media.set(id, { media: id, faces: m.faces.map((f) => ({ ...f })) });
      m.faces.forEach((face, index) => {
        const key = faceKey(id, index);
        const vec = dequantizeEmbedding(face.emb);
        if (!vec) return;
        state.vectors.set(key, vec);
        if (face.person) state.addToCluster(state.root(face.person), key, vec, id);
      });
    }
    return state;
  }

  /** An independent copy (vectors are immutable and shared). */
  clone(): FacesState {
    const clusters = new Map<string, Cluster>();
    for (const [id, c] of this.clusters) {
      clusters.set(id, {
        id,
        sum: Float64Array.from(c.sum),
        centroid: c.centroid,
        faces: new Set(c.faces),
        media: new Map(c.media),
      });
    }
    return new FacesState(
      this.model,
      new Map(this.people),
      new Map(this.media),
      new Map(this.vectors),
      clusters,
      new Map(this.faceRoot)
    );
  }

  /** A snapshot for serialization; later changes to this state don't affect it. */
  toDoc(): FacesDoc {
    return { model: this.model, people: new Map(this.people), media: new Map(this.media) };
  }

  hasMedia(mediaId: string): boolean {
    return this.media.has(mediaId);
  }

  mediaIds(): IterableIterator<string> {
    return this.media.keys();
  }

  get mediaCount(): number {
    return this.media.size;
  }

  get faceCount(): number {
    return this.vectors.size;
  }

  face(key: string): FaceRecord | null {
    const loc = parseFaceKey(key);
    return (loc && this.media.get(loc.mediaId)?.faces[loc.index]) || null;
  }

  /** Faces found in a media item (empty when none, or not scanned). */
  facesIn(mediaId: string): readonly FaceRecord[] {
    return this.media.get(mediaId)?.faces ?? [];
  }

  /** The person `id` resolves to after merges. */
  root(id: string): string {
    let current = id;
    for (let i = 0; i < 64; i++) {
      const next = this.people.get(current)?.into;
      if (!next) return current;
      current = next;
    }
    return current;
  }

  /** The person a face belongs to (null when it isn't grouped). */
  personOfFace(key: string): string | null {
    return this.faceRoot.get(key) ?? null;
  }

  groups(): PersonGroup[] {
    const out: PersonGroup[] = [];
    for (const c of this.clusters.values()) {
      const line = this.people.get(c.id);
      out.push({
        id: c.id,
        name: line?.name ?? null,
        hidden: Boolean(line?.hidden),
        cover: line?.cover && this.faceRoot.get(line.cover) === c.id ? line.cover : null,
        faces: Array.from(c.faces),
      });
    }
    return out;
  }

  /** Distance between two people's centroids (Infinity when either has no faces). */
  distanceBetween(a: string, b: string): number {
    const ca = this.clusters.get(this.root(a));
    const cb = this.clusters.get(this.root(b));
    if (!ca || !cb) return Infinity;
    return distanceFromDot(dot(ca.centroid, cb.centroid));
  }

  /** Applies one operation; false when it changed nothing (already applied, or stale). */
  apply(op: FacesOp): boolean {
    switch (op.op) {
      case "scan":
        return this.applyScan(op.media, op.faces);
      case "name":
        return this.updateLine(this.root(op.person), (line) => {
          const name = cleanName(op.name);
          if (name) line.name = name;
          else delete line.name;
        });
      case "hide":
        return this.updateLine(this.root(op.person), (line) => {
          if (op.hidden) line.hidden = true;
          else delete line.hidden;
        });
      case "cover": {
        const root = this.root(op.person);
        if (this.faceRoot.get(op.face) !== root) return false;
        return this.updateLine(root, (line) => {
          line.cover = op.face;
        });
      }
      case "merge":
        return this.applyMerge(op.people, op.into);
      case "reject":
        return this.applyReject(op.person, op.faces);
      default:
        return false;
    }
  }

  /** Drops faces of media that left the library for good (not in `keep`). */
  forgetMediaExcept(keep: ReadonlySet<string>): boolean {
    let changed = false;
    for (const [id, m] of Array.from(this.media)) {
      if (keep.has(id)) continue;
      m.faces.forEach((_, index) => {
        const key = faceKey(id, index);
        const vec = this.vectors.get(key);
        const root = this.faceRoot.get(key);
        if (vec && root) this.removeFromCluster(root, key, vec, id);
        this.vectors.delete(key);
      });
      this.media.delete(id);
      changed = true;
    }
    if (!changed) return false;
    for (const [id, line] of Array.from(this.people)) {
      if (line.cover && !this.faceRoot.has(line.cover)) {
        const next = { ...line };
        delete next.cover;
        this.people.set(id, next);
      }
    }
    return true;
  }

  // --- internals ---------------------------------------------------------------------------

  private breakAliasCycles(): void {
    for (const id of Array.from(this.people.keys())) {
      const seen = new Set<string>();
      let current = id;
      while (true) {
        const line = this.people.get(current);
        if (!line?.into) break;
        if (seen.has(current)) {
          const next = { ...line };
          delete next.into;
          this.people.set(current, next);
          break;
        }
        seen.add(current);
        current = line.into;
      }
    }
  }

  private updateLine(id: string, change: (line: PersonRecord) => void): boolean {
    const before = this.people.get(id);
    const next: PersonRecord = before ? { ...before } : { person: id };
    change(next);
    const same =
      before !== undefined
        ? before.name === next.name &&
          before.hidden === next.hidden &&
          before.cover === next.cover &&
          before.into === next.into
        : !next.name && !next.hidden && !next.cover && !next.into;
    if (same) return false;
    this.people.set(id, next);
    return true;
  }

  private newPersonId(seed: string): string {
    let id = personIdFor(seed);
    for (let n = 1; this.clusters.has(id) || this.people.has(id); n++) id = personIdFor(`${seed}~${n}`);
    return id;
  }

  private addToCluster(id: string, key: string, vec: Float32Array, mediaId: string): void {
    let c = this.clusters.get(id);
    if (!c) {
      c = { id, sum: new Float64Array(EMBEDDING_DIMS), centroid: vec, faces: new Set(), media: new Map() };
      this.clusters.set(id, c);
    }
    for (let i = 0; i < EMBEDDING_DIMS; i++) c.sum[i] += vec[i];
    c.faces.add(key);
    c.media.set(mediaId, (c.media.get(mediaId) ?? 0) + 1);
    this.faceRoot.set(key, id);
    this.updateCentroid(c);
  }

  private removeFromCluster(id: string, key: string, vec: Float32Array, mediaId: string): void {
    const c = this.clusters.get(id);
    this.faceRoot.delete(key);
    if (!c || !c.faces.delete(key)) return;
    if (c.faces.size === 0) {
      this.clusters.delete(id);
      return;
    }
    for (let i = 0; i < EMBEDDING_DIMS; i++) c.sum[i] -= vec[i];
    const left = (c.media.get(mediaId) ?? 1) - 1;
    if (left > 0) c.media.set(mediaId, left);
    else c.media.delete(mediaId);
    this.updateCentroid(c);
  }

  private updateCentroid(c: Cluster): void {
    let norm = 0;
    for (let i = 0; i < EMBEDDING_DIMS; i++) norm += c.sum[i] * c.sum[i];
    norm = Math.sqrt(norm);
    const centroid = new Float32Array(EMBEDDING_DIMS);
    if (norm > 0) for (let i = 0; i < EMBEDDING_DIMS; i++) centroid[i] = c.sum[i] / norm;
    c.centroid = centroid;
  }

  /** The nearest person above `minDot`, skipping `exclude` and people already in `mediaId`. */
  private nearest(
    vec: Float32Array,
    mediaId: string,
    minDot: number,
    exclude?: ReadonlySet<string>
  ): { cluster: Cluster; dot: number } | null {
    let best: Cluster | null = null;
    let bestDot = minDot;
    for (const c of this.clusters.values()) {
      const d = dot(vec, c.centroid);
      if (d < bestDot || (best && d === bestDot && c.id > best.id)) continue;
      if (c.media.has(mediaId) || exclude?.has(c.id)) continue;
      best = c;
      bestDot = d;
    }
    return best ? { cluster: best, dot: bestDot } : null;
  }

  private applyScan(mediaId: string, scanned: readonly ScannedFace[]): boolean {
    // Another model's embeddings can't be compared with ours (the file came from another version).
    if (this.media.has(mediaId) || this.model !== FACE_MODEL) return false;
    const faces: FaceRecord[] = [];
    for (const f of scanned) {
      const box = normalizeBox(f.box);
      if (!box || typeof f.emb !== "string") continue;
      const score = Number.isFinite(f.score) ? Math.round(Math.min(1, Math.max(0, f.score)) * 100) / 100 : 0;
      faces.push({ box, score, emb: f.emb });
    }
    // Reading order, so indexes (and face keys) don't depend on the detector's output order.
    faces.sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1] || byId(a.emb, b.emb));
    this.media.set(mediaId, { media: mediaId, faces });

    // Most confident matches first; each face may still only take a person not yet in this photo.
    const pending: Array<{ index: number; key: string; vec: Float32Array; match: Cluster | null; best: number }> = [];
    faces.forEach((face, index) => {
      const key = faceKey(mediaId, index);
      const vec = dequantizeEmbedding(face.emb);
      if (!vec) return;
      this.vectors.set(key, vec);
      const match = this.nearest(vec, mediaId, ASSIGN_DOT);
      pending.push({ index, key, vec, match: match?.cluster ?? null, best: match?.dot ?? -2 });
    });
    pending.sort((a, b) => b.best - a.best || a.index - b.index);

    // Only people who gained a face moved; a brand-new person matched nobody within
    // ASSIGN_DISTANCE, so nobody is within the (smaller) MERGE_DISTANCE of them either.
    const grown: string[] = [];
    for (const item of pending) {
      let match = item.match;
      // Taken by a more confident face of this photo (or merged away): look again.
      if (match && (match.media.has(mediaId) || this.clusters.get(match.id) !== match)) {
        match = this.nearest(item.vec, mediaId, ASSIGN_DOT)?.cluster ?? null;
      }
      const id = match ? match.id : this.newPersonId(item.key);
      this.addToCluster(id, item.key, item.vec, mediaId);
      faces[item.index] = { ...faces[item.index], person: id };
      if (match) grown.push(id);
    }
    this.autoMerge(grown);
    return true;
  }

  private rejectsOf(c: Cluster): Set<string> {
    const out = new Set<string>();
    for (const key of c.faces) {
      for (const id of this.face(key)?.not ?? []) out.add(this.root(id));
    }
    return out;
  }

  private canAutoMerge(a: Cluster, b: Cluster): boolean {
    const la = this.people.get(a.id);
    const lb = this.people.get(b.id);
    if (la?.name && lb?.name && !sameName(la.name, lb.name)) return false;
    if (Boolean(la?.hidden) !== Boolean(lb?.hidden)) return false;
    const [small, large] = a.media.size <= b.media.size ? [a, b] : [b, a];
    for (const mediaId of small.media.keys()) if (large.media.has(mediaId)) return false;
    if (this.rejectsOf(a).has(b.id) || this.rejectsOf(b).has(a.id)) return false;
    return true;
  }

  private survivorRank(c: Cluster): number {
    const line = this.people.get(c.id);
    return (line?.name ? 4 : 0) + (line && (line.hidden || line.cover) ? 2 : 0);
  }

  private autoMerge(touched: readonly string[]): void {
    const queue = Array.from(new Set(touched));
    for (let guard = 0; queue.length > 0 && guard < 10_000; guard++) {
      const c = this.clusters.get(queue.shift()!);
      if (!c) continue;
      let best: Cluster | null = null;
      let bestDot = MERGE_DOT;
      for (const o of this.clusters.values()) {
        if (o === c) continue;
        const d = dot(c.centroid, o.centroid);
        if (d < bestDot || (best && d === bestDot && o.id > best.id)) continue;
        if (!this.canAutoMerge(c, o)) continue;
        best = o;
        bestDot = d;
      }
      if (!best) continue;
      const rank = this.survivorRank(c) - this.survivorRank(best);
      const keepC =
        rank > 0 ||
        (rank === 0 && (c.faces.size > best.faces.size || (c.faces.size === best.faces.size && c.id < best.id)));
      const [winner, loser] = keepC ? [c, best] : [best, c];
      this.absorb(winner, loser);
      queue.push(winner.id);
    }
  }

  /** Moves every face of `loser` to `winner` and records the alias; names are never lost. */
  private absorb(winner: Cluster, loser: Cluster): void {
    for (const key of loser.faces) {
      winner.faces.add(key);
      this.faceRoot.set(key, winner.id);
    }
    for (const [mediaId, n] of loser.media) winner.media.set(mediaId, (winner.media.get(mediaId) ?? 0) + n);
    for (let i = 0; i < EMBEDDING_DIMS; i++) winner.sum[i] += loser.sum[i];
    this.updateCentroid(winner);
    this.clusters.delete(loser.id);
    const loserLine = this.people.get(loser.id);
    this.updateLine(loser.id, (line) => {
      line.into = winner.id;
    });
    if (loserLine?.name && !this.people.get(winner.id)?.name) {
      this.updateLine(winner.id, (line) => {
        line.name = loserLine.name;
      });
    }
  }

  private applyMerge(people: readonly string[], into: string): boolean {
    const target = this.root(into);
    let changed = false;
    for (const id of people) {
      const from = this.root(id);
      if (from === target) continue;
      const winner = this.clusters.get(target);
      const loser = this.clusters.get(from);
      if (winner && loser) {
        // The user says they're one person: earlier "not this person" between them no longer applies.
        this.dropRejections(loser, target, from);
        this.dropRejections(winner, from, target);
        this.absorb(winner, loser);
      } else if (loser) {
        // The target has no faces left (e.g. all deleted): the merged person takes over the name.
        this.clusters.delete(from);
        this.clusters.set(target, { ...loser, id: target });
        for (const key of loser.faces) this.faceRoot.set(key, target);
        const name = this.people.get(from)?.name;
        this.updateLine(from, (line) => {
          line.into = target;
        });
        if (name && !this.people.get(target)?.name) this.updateLine(target, (line) => (line.name = name));
      } else {
        const name = this.people.get(from)?.name;
        this.updateLine(from, (line) => {
          line.into = target;
        });
        if (name && !this.people.get(target)?.name) this.updateLine(target, (line) => (line.name = name));
      }
      changed = true;
    }
    return changed;
  }

  /** Removes rejections of people resolving to `a` or `b` from the faces of `c`. */
  private dropRejections(c: Cluster, a: string, b: string): void {
    for (const key of c.faces) {
      const loc = parseFaceKey(key);
      const m = loc && this.media.get(loc.mediaId);
      const face = loc && m?.faces[loc.index];
      if (!loc || !m || !face?.not) continue;
      const not = face.not.filter((id) => {
        const r = this.root(id);
        return r !== a && r !== b;
      });
      if (not.length === face.not.length) continue;
      this.replaceFace(m, loc.index, not.length > 0 ? { ...face, not } : withoutNot(face));
    }
  }

  private replaceFace(m: MediaFaces, index: number, face: FaceRecord): void {
    const faces = m.faces.slice();
    faces[index] = face;
    this.media.set(m.media, { media: m.media, faces });
  }

  private applyReject(person: string, keys: readonly string[]): boolean {
    const from = this.root(person);
    let changed = false;
    for (const key of Array.from(new Set(keys)).sort(byId)) {
      const loc = parseFaceKey(key);
      const m = loc && this.media.get(loc.mediaId);
      const face = loc && m?.faces[loc.index];
      const vec = this.vectors.get(key);
      if (!loc || !m || !face || !vec || this.faceRoot.get(key) !== from) continue;
      this.removeFromCluster(from, key, vec, loc.mediaId);
      const not = Array.from(new Set([...(face.not ?? []), from])).sort(byId);
      const exclude = new Set(not.map((id) => this.root(id)));
      const match = this.nearest(vec, loc.mediaId, REASSIGN_DOT, exclude);
      const id = match ? match.cluster.id : this.newPersonId(`${key}|${not.join(",")}`);
      this.addToCluster(id, key, vec, loc.mediaId);
      this.replaceFace(m, loc.index, { ...face, person: id, not });
      changed = true;
    }
    return changed;
  }
}

function withoutNot(face: FaceRecord): FaceRecord {
  const next = { ...face };
  delete next.not;
  return next;
}

/** Replays `ops` on `state`, yielding to the event loop now and then so the UI stays smooth. */
export async function applyOps(
  state: FacesState,
  ops: readonly FacesOp[],
  options: { sliceMs?: number } = {}
): Promise<number> {
  const sliceMs = options.sliceMs ?? 12;
  let changed = 0;
  let sliceStart = Date.now();
  for (const op of ops) {
    if (state.apply(op)) changed++;
    if (Date.now() - sliceStart > sliceMs) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      sliceStart = Date.now();
    }
  }
  return changed;
}
