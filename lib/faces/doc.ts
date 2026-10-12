// manifest/faces.json: the faces found in the library, the people they were grouped into and
// the user's corrections, shared by every device (docs/FACES.md). Pure parse/serialize code.
//
// One JSON value per line (lib/github/jsonArray), in a fixed order so a commit changes only
// the lines that changed:
//   {"version":1,"model":"…"}                                   header, always first
//   {"person":"person_…","name":"Mum","hidden":true,"cover":"media_…#0","into":"person_…"}
//   {"media":"media_…","faces":[{"box":[x,y,w,h],"score":0.93,"emb":"…","person":"person_…","not":["person_…"]}]}
// People are sorted by id, then media by id. A person line exists only when the person has
// something to remember (a name, hidden, a chosen cover, or "merged into").

import { base64ToBytes, bytesToBase64 } from "@/lib/github/bytes";
import { parseJsonArray, serializeJsonArray } from "@/lib/github/jsonArray";
import type { FaceBox } from "./people";

export const FACES_PATH = "manifest/faces.json";
export const FACES_FORMAT = 1;
/** Embeddings from different models can't be compared: every line in the file belongs to this one. */
export const FACE_MODEL = "face-api-1.7.15/tiny-512+224/landmarks-68-tiny/recognition-128/l2-int8x254";
export const EMBEDDING_DIMS = 128;
/** int8 = round(component of the L2-normalized descriptor × 254), clamped to ±127. */
export const EMBEDDING_SCALE = 254;
export const NAME_MAX_LENGTH = 60;

const PERSON_ID = /^person_[a-z0-9]{1,40}$/;
const MEDIA_ID = /^media_[A-Za-z0-9_-]{1,80}$/;
const EMB_CHARS = Math.ceil(EMBEDDING_DIMS / 3) * 4;

export interface FaceRecord {
  box: FaceBox;
  /** Detector confidence, 2 decimals. */
  score: number;
  /** base64 of the EMBEDDING_DIMS int8 components. */
  emb: string;
  /** The person this face belongs to (may be an alias resolved through `into`). */
  person?: string;
  /** People the user said this face is not ("not this person"), sorted. */
  not?: string[];
}

export interface MediaFaces {
  media: string;
  faces: FaceRecord[];
}

export interface PersonRecord {
  person: string;
  name?: string;
  hidden?: true;
  /** Face key ("<mediaId>#<index>") chosen as the avatar. */
  cover?: string;
  /** Merged into this person: their faces count as that person's. */
  into?: string;
}

export interface FacesDoc {
  /** The model the file's embeddings were made with (FACE_MODEL unless another app version wrote it). */
  model: string;
  people: Map<string, PersonRecord>;
  media: Map<string, MediaFaces>;
}

export function isPersonId(value: unknown): value is string {
  return typeof value === "string" && PERSON_ID.test(value);
}

export function faceKey(mediaId: string, index: number): string {
  return `${mediaId}#${index}`;
}

export function parseFaceKey(key: string): { mediaId: string; index: number } | null {
  const hash = key.lastIndexOf("#");
  if (hash < 0) return null;
  const mediaId = key.slice(0, hash);
  const index = Number(key.slice(hash + 1));
  if (!MEDIA_ID.test(mediaId) || !Number.isInteger(index) || index < 0) return null;
  return { mediaId, index };
}

export function emptyDoc(model = FACE_MODEL): FacesDoc {
  return { model, people: new Map(), media: new Map() };
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** A box clamped into the image, 4 decimals. */
export function normalizeBox(box: ArrayLike<number>): FaceBox | null {
  if (!box || box.length !== 4) return null;
  const [x0, y0, w0, h0] = Array.from(box, Number);
  if (![x0, y0, w0, h0].every(Number.isFinite)) return null;
  const x = Math.min(1, Math.max(0, x0));
  const y = Math.min(1, Math.max(0, y0));
  const w = Math.min(1 - x, Math.max(0, w0));
  const h = Math.min(1 - y, Math.max(0, h0));
  if (w <= 0 || h <= 0) return null;
  return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)];
}

/** Normalizes a raw descriptor and stores it as base64 int8 (null for NaN/zero vectors). */
export function quantizeEmbedding(descriptor: ArrayLike<number>): string | null {
  if (!descriptor || descriptor.length !== EMBEDDING_DIMS) return null;
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += descriptor[i] * descriptor[i];
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return null;
  const bytes = new Uint8Array(EMBEDDING_DIMS);
  const view = new Int8Array(bytes.buffer);
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    view[i] = Math.max(-127, Math.min(127, Math.round((descriptor[i] / norm) * EMBEDDING_SCALE)));
  }
  return bytesToBase64(bytes);
}

/** The unit vector stored in `emb`, or null when it isn't a valid embedding. */
export function dequantizeEmbedding(emb: string): Float32Array | null {
  if (typeof emb !== "string" || emb.length !== EMB_CHARS) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(emb);
  } catch {
    return null;
  }
  if (bytes.length !== EMBEDDING_DIMS) return null;
  const view = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  const out = new Float32Array(EMBEDDING_DIMS);
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) {
    out[i] = view[i];
    norm += view[i] * view[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  for (let i = 0; i < EMBEDDING_DIMS; i++) out[i] /= norm;
  return out;
}

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH).trim();
  return name || null;
}

function sortedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(isPersonId))).sort();
}

function parseFace(raw: unknown): FaceRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const box = Array.isArray(f.box) ? normalizeBox(f.box as number[]) : null;
  if (!box || typeof f.emb !== "string" || f.emb.length !== EMB_CHARS) return null;
  const face: FaceRecord = {
    box,
    score: typeof f.score === "number" && Number.isFinite(f.score) ? round(Math.min(1, Math.max(0, f.score)), 2) : 0,
    emb: f.emb,
  };
  if (isPersonId(f.person)) face.person = f.person;
  const not = sortedIds(f.not);
  if (not.length > 0) face.not = not;
  return face;
}

/** Reads faces.json; a missing/blank file is an empty doc, a non-array throws CorruptJsonError. */
export function parseFacesDoc(text: string | null): FacesDoc {
  const doc = emptyDoc();
  for (const raw of parseJsonArray<unknown>(FACES_PATH, text)) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (typeof entry.version === "number") {
      if (typeof entry.model === "string" && entry.model) doc.model = entry.model;
      continue;
    }
    if (isPersonId(entry.person)) {
      const person: PersonRecord = { person: entry.person };
      const name = cleanName(entry.name);
      if (name) person.name = name;
      if (entry.hidden === true) person.hidden = true;
      if (typeof entry.cover === "string" && parseFaceKey(entry.cover)) person.cover = entry.cover;
      if (isPersonId(entry.into) && entry.into !== entry.person) person.into = entry.into;
      doc.people.set(person.person, person);
      continue;
    }
    if (typeof entry.media === "string" && MEDIA_ID.test(entry.media) && Array.isArray(entry.faces)) {
      const faces = entry.faces.map(parseFace).filter((face): face is FaceRecord => face !== null);
      doc.media.set(entry.media, { media: entry.media, faces });
    }
  }
  return doc;
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function personLine(p: PersonRecord): PersonRecord {
  const line: PersonRecord = { person: p.person };
  if (p.name) line.name = p.name;
  if (p.hidden) line.hidden = true;
  if (p.cover) line.cover = p.cover;
  if (p.into) line.into = p.into;
  return line;
}

function faceLine(f: FaceRecord): FaceRecord {
  const line: FaceRecord = { box: f.box, score: f.score, emb: f.emb };
  if (f.person) line.person = f.person;
  if (f.not && f.not.length > 0) line.not = [...f.not].sort(byId);
  return line;
}

/** Whether a person line carries anything worth writing. */
export function personHasData(p: PersonRecord): boolean {
  return Boolean(p.name || p.hidden || p.cover || p.into);
}

/** The exact text of faces.json for `doc`: same doc, same bytes, whoever writes it. */
export function serializeFacesDoc(doc: FacesDoc): string {
  const lines: unknown[] = [{ version: FACES_FORMAT, model: doc.model }];
  const people = Array.from(doc.people.values()).filter(personHasData);
  people.sort((a, b) => byId(a.person, b.person));
  for (const p of people) lines.push(personLine(p));
  const media = Array.from(doc.media.values()).sort((a, b) => byId(a.media, b.media));
  for (const m of media) lines.push({ media: m.media, faces: m.faces.map(faceLine) });
  return serializeJsonArray(lines);
}
