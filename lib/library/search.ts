// Smart search over the media index. A query is split into words and the longest known
// phrases are picked out — people, album names, categories, dates, types, "favorites" — so
// they combine ("anna whatsapp october 2024"); words left over match file names and folders.
// Pure (no browser APIs), so plain node scripts can test the parser and the matching.
//
// Combining: people must all be in the item; other terms of the same kind are alternatives
// ("2023 2024", "png gif"); different kinds must all hold. A month without a year ("october")
// means that month in any year and narrows a year or range given beside it ("october 2024",
// "october in 2024").

import type { MediaIndexEntry } from "@/lib/media/types";
import {
  EDITED_CATEGORY,
  inCategory,
  SOURCE_CATEGORIES,
  VIDEOS_CATEGORY,
  type SourceId,
} from "./categories";
import { mediaTime } from "./dates";

export type MediaType = "video" | "photo" | "gif" | "png" | "jpeg" | "webp" | "heic" | "raw" | "selfie";

export interface SearchPerson {
  id: string;
  name: string;
  mediaIds: readonly string[];
  /** Avatar for suggestions. */
  cover?: { mediaId: string; box: [number, number, number, number] } | null;
}

export interface SearchAlbum {
  id: string;
  name: string;
  mediaIds: readonly string[];
  coverId?: string;
}

/** A category the library has: id, name, item count and a cover for suggestions. */
export interface SearchCategory {
  id: string;
  name: string;
  count?: number;
  coverId?: string;
}

export interface SearchContext {
  people: readonly SearchPerson[];
  albums: readonly SearchAlbum[];
  /** Categories present in the library; the built-in sources are understood either way. */
  categories: readonly SearchCategory[];
  now: Date;
}

interface TermBase {
  /** Where the words came from in the query, for removing the term again. */
  start: number;
  end: number;
  label: string;
}

export type SearchTerm = TermBase &
  (
    | { kind: "person"; id: string; mediaIds: ReadonlySet<string> }
    | { kind: "album"; id: string; mediaIds: ReadonlySet<string> }
    | { kind: "category"; id: string }
    | { kind: "range"; startTime: number; endTime: number }
    | { kind: "month"; month: number; day?: number }
    | { kind: "type"; type: MediaType }
    | { kind: "favorite" }
    | { kind: "edited" }
    | { kind: "text"; text: string }
  );

/** A term before it's placed in the query (Omit applied to each variant, not to the union). */
type TermData = SearchTerm extends infer T ? (T extends unknown ? Omit<T, "start" | "end"> : never) : never;

export interface ParsedQuery {
  terms: SearchTerm[];
}

// ---- words ------------------------------------------------------------------

interface Token {
  text: string;
  /** Lowercased, accents removed, wrapping punctuation trimmed. */
  norm: string;
  start: number;
  end: number;
}

/** Lowercase without accents, so "José" matches "jose". */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  for (const match of query.matchAll(/[^\s,;]+/g)) {
    const text = match[0];
    const norm = fold(text).replace(/^["'“”‘’(\[]+|["'“”‘’)\].!?:]+$/g, "");
    if (!norm) continue;
    const start = match.index ?? 0;
    tokens.push({ text, norm, start, end: start + text.length });
  }
  return tokens;
}

function words(value: string): string[] {
  return tokenize(value).map((t) => t.norm);
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "&", "+", "in", "on", "at", "from", "of", "with", "during", "my", "taken",
  "around", "by", "for", "to", "near", "all", "only", "show", "me", "some", "any",
]);

// ---- vocabulary ---------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_LABELS = MONTHS.map((m) => m.charAt(0).toUpperCase() + m.slice(1));

function monthIndex(word: string): number {
  if (word.length < 3) return -1;
  const clean = word.replace(/\.$/, "");
  if (clean === "sept") return 8;
  return MONTHS.findIndex((m) => m === clean || (clean.length === 3 && m.startsWith(clean)));
}

const TYPE_WORDS: Record<string, MediaType> = {
  video: "video", videos: "video", vid: "video", vids: "video", movie: "video", movies: "video", clip: "video", clips: "video",
  photo: "photo", photos: "photo", picture: "photo", pictures: "photo", pic: "photo", pics: "photo", image: "photo", images: "photo",
  gif: "gif", gifs: "gif", animation: "gif", animations: "gif",
  png: "png", pngs: "png",
  jpg: "jpeg", jpeg: "jpeg", jpgs: "jpeg", jpegs: "jpeg",
  webp: "webp",
  heic: "heic", heif: "heic",
  raw: "raw", raws: "raw", dng: "raw",
  selfie: "selfie", selfies: "selfie",
};

export const TYPE_LABELS: Record<MediaType, string> = {
  video: "Videos",
  photo: "Photos",
  gif: "GIFs",
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  heic: "HEIC",
  raw: "RAW",
  selfie: "Selfies",
};

const FAVORITE_WORDS = ["favorite", "favorites", "favourite", "favourites", "fav", "favs", "fave", "faves", "starred", "liked", "hearted"];
const EDITED_WORDS = ["edited", "edits", "edit"];

/** Extra phrases (beyond the name) each built-in source answers to. */
const SOURCE_SYNONYMS: Record<SourceId, string[]> = {
  camera: ["camera", "camera roll", "dcim"],
  screenshots: ["screenshot", "screenshots", "screen shot", "screen shots"],
  "screen-recordings": ["screen recording", "screen recordings", "screen record", "screenrecord", "screen recorder", "recording", "recordings"],
  whatsapp: ["whatsapp", "whats app"],
  instagram: ["instagram", "insta"],
  telegram: ["telegram"],
  snapchat: ["snapchat", "snap", "snaps"],
  facebook: ["facebook", "fb", "messenger"],
  downloads: ["download", "downloads", "downloaded"],
};

const RAW_TYPES = /^image\/(x-adobe-dng|x-canon-cr[23w]|x-nikon-nef|x-sony-arw|x-olympus-orf|x-panasonic-rw2?|x-fuji-raf|x-samsung-srw|x-pentax-pef|x-dcraw|raw|x-raw)$/;
const RAW_EXTENSIONS = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|srw|pef|raw)$/;
const SELFIE = /selfie|front[ _-]?cam/;

function extensionIs(filename: string, pattern: RegExp): boolean {
  return pattern.test(filename.toLowerCase());
}

export function matchesType(entry: MediaIndexEntry, type: MediaType): boolean {
  const mime = entry.mimeType?.toLowerCase() ?? "";
  const name = entry.filename ?? "";
  switch (type) {
    case "video":
      return mime.startsWith("video/");
    case "photo":
      return mime.startsWith("image/");
    case "gif":
      return mime === "image/gif" || extensionIs(name, /\.gif$/);
    case "png":
      return mime === "image/png" || extensionIs(name, /\.png$/);
    case "jpeg":
      return /^image\/p?jpe?g$/.test(mime) || extensionIs(name, /\.jpe?g$/);
    case "webp":
      return mime === "image/webp" || extensionIs(name, /\.webp$/);
    case "heic":
      return /^image\/hei[cf](-sequence)?$/.test(mime) || extensionIs(name, /\.hei[cf]$/);
    case "raw":
      return RAW_TYPES.test(mime) || extensionIs(name, RAW_EXTENSIONS);
    case "selfie":
      // Only some phones say so, in the folder or the file name.
      return SELFIE.test(fold(name)) || SELFIE.test(fold(entry.folder ?? ""));
  }
}

// ---- dates ---------------------------------------------------------------------

type DateMatch = { length: number; term: TermData };

function range(label: string, start: Date, end: Date): TermData {
  return { kind: "range", label, startTime: start.getTime(), endTime: end.getTime() };
}

function yearOf(word: string | undefined): number | null {
  if (!word || !/^\d{4}$/.test(word)) return null;
  const year = Number(word);
  return year >= 1900 && year <= 2100 ? year : null;
}

function dayOf(word: string | undefined): number | null {
  const m = word ? /^(\d{1,2})(st|nd|rd|th)?$/.exec(word) : null;
  if (!m) return null;
  const day = Number(m[1]);
  return day >= 1 && day <= 31 ? day : null;
}

function startOfWeek(date: Date): Date {
  // Weeks start on Monday.
  const day = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
}

function fullDateLabel(y: number, m: number, d: number): string {
  return new Date(y, m, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A date phrase starting at token `i`, longest first. */
function matchDate(tokens: readonly Token[], i: number, now: Date): DateMatch | null {
  const w = (k: number) => tokens[i + k]?.norm;
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = new Date(y, m, now.getDate());

  if (w(0) === "today") return { length: 1, term: range("Today", today, new Date(y, m, now.getDate() + 1)) };
  if (w(0) === "yesterday") return { length: 1, term: range("Yesterday", new Date(y, m, now.getDate() - 1), today) };
  if ((w(0) === "this" || w(0) === "last" || w(0) === "past") && (w(1) === "week" || w(1) === "month" || w(1) === "year")) {
    const previous = w(0) !== "this";
    const label = `${previous ? "Last" : "This"} ${w(1)}`;
    if (w(1) === "week") {
      const start = startOfWeek(today);
      if (!previous) return { length: 2, term: range(label, start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) };
      return { length: 2, term: range(label, new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7), start) };
    }
    if (w(1) === "month") {
      return previous
        ? { length: 2, term: range(label, new Date(y, m - 1, 1), new Date(y, m, 1)) }
        : { length: 2, term: range(label, new Date(y, m, 1), new Date(y, m + 1, 1)) };
    }
    return previous
      ? { length: 2, term: range(label, new Date(y - 1, 0, 1), new Date(y, 0, 1)) }
      : { length: 2, term: range(label, new Date(y, 0, 1), new Date(y + 1, 0, 1)) };
  }

  // 2024-10-05, 2024-10
  const iso = w(0) ? /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(w(0) as string) : null;
  if (iso && yearOf(iso[1]) !== null) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    if (month >= 0 && month <= 11) {
      if (iso[3]) {
        const day = Number(iso[3]);
        if (day >= 1 && day <= 31) {
          return { length: 1, term: range(fullDateLabel(year, month, day), new Date(year, month, day), new Date(year, month, day + 1)) };
        }
      } else {
        return { length: 1, term: range(`${MONTH_LABELS[month]} ${year}`, new Date(year, month, 1), new Date(year, month + 1, 1)) };
      }
    }
  }

  // month [day] [year] · day month [year] · month year · year month
  const month0 = monthIndex(w(0) ?? "");
  if (month0 >= 0) {
    const day = dayOf(w(1));
    if (day !== null) {
      const year = yearOf(w(2));
      if (year !== null) {
        return { length: 3, term: range(fullDateLabel(year, month0, day), new Date(year, month0, day), new Date(year, month0, day + 1)) };
      }
      return { length: 2, term: { kind: "month", label: `${MONTH_LABELS[month0]} ${day}`, month: month0, day } };
    }
    const year = yearOf(w(1));
    if (year !== null) {
      return { length: 2, term: range(`${MONTH_LABELS[month0]} ${year}`, new Date(year, month0, 1), new Date(year, month0 + 1, 1)) };
    }
    return { length: 1, term: { kind: "month", label: MONTH_LABELS[month0], month: month0 } };
  }
  const day0 = dayOf(w(0));
  const month1 = monthIndex(w(1) ?? "");
  if (day0 !== null && month1 >= 0) {
    const year = yearOf(w(2));
    if (year !== null) {
      return { length: 3, term: range(fullDateLabel(year, month1, day0), new Date(year, month1, day0), new Date(year, month1, day0 + 1)) };
    }
    return { length: 2, term: { kind: "month", label: `${MONTH_LABELS[month1]} ${day0}`, month: month1, day: day0 } };
  }
  const year0 = yearOf(w(0));
  if (year0 !== null) {
    const month = monthIndex(w(1) ?? "");
    if (month >= 0) {
      return { length: 2, term: range(`${MONTH_LABELS[month]} ${year0}`, new Date(year0, month, 1), new Date(year0, month + 1, 1)) };
    }
    return { length: 1, term: range(String(year0), new Date(year0, 0, 1), new Date(year0 + 1, 0, 1)) };
  }
  return null;
}

// ---- phrases --------------------------------------------------------------------

type Phrase = { priority: number; term: TermData };

interface Vocabulary {
  phrases: Map<string, Phrase[]>;
  maxWords: number;
}

// Built once per context; the UI memoizes the context itself.
const vocabularies = new WeakMap<SearchContext, Vocabulary>();

function addPhrase(vocab: Vocabulary, phrase: string, entry: Phrase) {
  const key = words(phrase).join(" ");
  if (!key) return;
  const list = vocab.phrases.get(key);
  if (list) list.push(entry);
  else vocab.phrases.set(key, [entry]);
  vocab.maxWords = Math.max(vocab.maxWords, key.split(" ").length);
}

function vocabularyFor(ctx: SearchContext): Vocabulary {
  const cached = vocabularies.get(ctx);
  if (cached) return cached;
  const vocab: Vocabulary = { phrases: new Map(), maxWords: 1 };

  // People: the full name, and the first name when no one else shares it.
  const firstNames = new Map<string, number>();
  for (const person of ctx.people) {
    const first = words(person.name)[0];
    if (first) firstNames.set(first, (firstNames.get(first) ?? 0) + 1);
  }
  for (const person of ctx.people) {
    if (!person.name.trim()) continue;
    const term = { kind: "person" as const, id: person.id, label: person.name, mediaIds: new Set(person.mediaIds) };
    addPhrase(vocab, person.name, { priority: 0, term });
    const parts = words(person.name);
    if (parts.length > 1 && firstNames.get(parts[0]) === 1) addPhrase(vocab, parts[0], { priority: 0, term });
  }
  for (const album of ctx.albums) {
    if (!album.name.trim()) continue;
    addPhrase(vocab, album.name, {
      priority: 1,
      term: { kind: "album", id: album.id, label: album.name, mediaIds: new Set(album.mediaIds) },
    });
  }
  for (const { id, name } of SOURCE_CATEGORIES) {
    const term = { kind: "category" as const, id, label: name };
    for (const phrase of [name, ...SOURCE_SYNONYMS[id]]) addPhrase(vocab, phrase, { priority: 2, term });
  }
  for (const category of ctx.categories) {
    if (category.id === VIDEOS_CATEGORY.id || category.id === EDITED_CATEGORY.id) continue;
    if (SOURCE_CATEGORIES.some((s) => s.id === category.id)) continue;
    addPhrase(vocab, category.name, { priority: 2, term: { kind: "category", id: category.id, label: category.name } });
  }
  for (const [word, type] of Object.entries(TYPE_WORDS)) {
    addPhrase(vocab, word, { priority: 3, term: { kind: "type", type, label: TYPE_LABELS[type] } });
  }
  for (const word of FAVORITE_WORDS) addPhrase(vocab, word, { priority: 3, term: { kind: "favorite", label: "Favorites" } });
  for (const word of EDITED_WORDS) addPhrase(vocab, word, { priority: 3, term: { kind: "edited", label: "Edited" } });

  vocab.maxWords = Math.min(vocab.maxWords, 8);
  vocabularies.set(ctx, vocab);
  return vocab;
}

/** Splits a query into search terms (see the top of this file). */
export function parseQuery(query: string, ctx: SearchContext): ParsedQuery {
  const tokens = tokenize(query);
  const vocab = vocabularyFor(ctx);
  const terms: SearchTerm[] = [];
  let i = 0;
  while (i < tokens.length) {
    let best: { length: number; priority: number; term: TermData } | null = null;
    for (let len = Math.min(vocab.maxWords, tokens.length - i); len >= 1; len--) {
      const key = tokens.slice(i, i + len).map((t) => t.norm).join(" ");
      const found = vocab.phrases.get(key);
      if (found) {
        const top = found.reduce((a, b) => (b.priority < a.priority ? b : a));
        best = { length: len, priority: top.priority, term: top.term };
        break;
      }
    }
    const date = matchDate(tokens, i, ctx.now);
    // Longest wins; on a tie a name the user gave (person, album) beats a date.
    if (date && (!best || date.length > best.length || (date.length === best.length && best.priority >= 2))) {
      best = { length: date.length, priority: 2.5, term: date.term };
    }
    if (best) {
      const start = tokens[i].start;
      const end = tokens[i + best.length - 1].end;
      terms.push({ ...best.term, start, end } as SearchTerm);
      i += best.length;
      continue;
    }
    const token = tokens[i];
    if (!STOPWORDS.has(token.norm)) {
      terms.push({ kind: "text", text: token.norm, label: `“${token.text}”`, start: token.start, end: token.end });
    }
    i += 1;
  }
  return { terms: dedupeTerms(terms) };
}

function termKey(term: SearchTerm): string {
  switch (term.kind) {
    case "person":
    case "album":
    case "category":
      return `${term.kind}:${term.id}`;
    case "range":
      return `range:${term.startTime}-${term.endTime}`;
    case "month":
      return `month:${term.month}:${term.day ?? ""}`;
    case "type":
      return `type:${term.type}`;
    case "text":
      return `text:${term.text}`;
    default:
      return term.kind;
  }
}

function dedupeTerms(terms: SearchTerm[]): SearchTerm[] {
  const seen = new Set<string>();
  return terms.filter((term) => {
    const key = termKey(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- matching -------------------------------------------------------------------

export type MediaPredicate = (entry: MediaIndexEntry) => boolean;

/** One predicate for a parsed query (null when it has no terms, i.e. matches everything). */
export function compileQuery(parsed: ParsedQuery): MediaPredicate | null {
  if (parsed.terms.length === 0) return null;
  const people: ReadonlySet<string>[] = [];
  const albums: ReadonlySet<string>[] = [];
  const categories: string[] = [];
  const ranges: [number, number][] = [];
  const months: { month: number; day?: number }[] = [];
  const types: MediaType[] = [];
  const texts: string[] = [];
  let favorite = false;
  let edited = false;
  for (const term of parsed.terms) {
    switch (term.kind) {
      case "person":
        people.push(term.mediaIds);
        break;
      case "album":
        albums.push(term.mediaIds);
        break;
      case "category":
        categories.push(term.id);
        break;
      case "range":
        ranges.push([term.startTime, term.endTime]);
        break;
      case "month":
        months.push({ month: term.month, day: term.day });
        break;
      case "type":
        types.push(term.type);
        break;
      case "favorite":
        favorite = true;
        break;
      case "edited":
        edited = true;
        break;
      case "text":
        texts.push(term.text);
        break;
    }
  }
  return (entry) => {
    if (favorite && !entry.favorite) return false;
    if (edited && !entry.editedFrom) return false;
    for (const ids of people) if (!ids.has(entry.id)) return false;
    if (albums.length > 0 && !albums.some((ids) => ids.has(entry.id))) return false;
    if (categories.length > 0 && !categories.some((id) => inCategory(entry, id))) return false;
    if (types.length > 0 && !types.some((type) => matchesType(entry, type))) return false;
    if (ranges.length > 0 || months.length > 0) {
      const time = mediaTime(entry);
      if (time <= 0) return false;
      if (ranges.length > 0 && !ranges.some(([start, end]) => time >= start && time < end)) return false;
      if (months.length > 0) {
        const date = new Date(time);
        if (!months.some((m) => date.getMonth() === m.month && (m.day === undefined || date.getDate() === m.day))) {
          return false;
        }
      }
    }
    if (texts.length > 0) {
      const name = fold(entry.filename ?? "");
      const folder = fold(entry.folder ?? "");
      for (const text of texts) if (!name.includes(text) && !folder.includes(text)) return false;
    }
    return true;
  };
}

/** The items matching `query`, in their order. */
export function searchItems(items: readonly MediaIndexEntry[], query: string, ctx: SearchContext): MediaIndexEntry[] {
  const predicate = compileQuery(parseQuery(query, ctx));
  return predicate ? items.filter(predicate) : [...items];
}

/** The query without one term's words (removing a chip). */
export function removeTerm(query: string, term: Pick<SearchTerm, "start" | "end">): string {
  return `${query.slice(0, term.start)} ${query.slice(term.end)}`.replace(/\s+/g, " ").trim();
}

// ---- suggestions ----------------------------------------------------------------

export interface LibraryFacts {
  /** Years with items, newest first. */
  years: number[];
  /** Months with items, newest first: [year, month 0-11, count]. */
  months: [number, number, number][];
  types: Partial<Record<MediaType, number>>;
  favorites: number;
  edited: number;
}

/** What suggestions can offer: which years, months and kinds of items exist. */
export function libraryFacts(items: readonly MediaIndexEntry[]): LibraryFacts {
  const years = new Set<number>();
  const months = new Map<string, [number, number, number]>();
  const types: Partial<Record<MediaType, number>> = {};
  let favorites = 0;
  let edited = 0;
  const countable: MediaType[] = ["video", "gif", "heic", "raw", "selfie", "png"];
  for (const item of items) {
    const time = mediaTime(item);
    if (time > 0) {
      const date = new Date(time);
      years.add(date.getFullYear());
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      const month = months.get(key);
      if (month) month[2] += 1;
      else months.set(key, [date.getFullYear(), date.getMonth(), 1]);
    }
    for (const type of countable) if (matchesType(item, type)) types[type] = (types[type] ?? 0) + 1;
    if (item.favorite) favorites += 1;
    if (item.editedFrom) edited += 1;
  }
  return {
    years: Array.from(years).sort((a, b) => b - a),
    months: Array.from(months.values()).sort((a, b) => b[0] - a[0] || b[1] - a[1]),
    types,
    favorites,
    edited,
  };
}

export type SuggestionKind = "person" | "category" | "date" | "album" | "type";

export interface Suggestion {
  key: string;
  kind: SuggestionKind;
  label: string;
  /** Words put into the query in place of what's being typed. */
  insert: string;
  count?: number;
  /** A thumbnail to show (categories, albums). */
  mediaId?: string;
  person?: SearchPerson;
}

export interface SuggestionGroup {
  title: string;
  items: Suggestion[];
}

export interface Suggestions {
  groups: SuggestionGroup[];
  /** Where the words being typed start: a suggestion replaces query.slice(replaceFrom). */
  replaceFrom: number;
}

const SUGGESTION_LIMITS = { person: 10, category: 14, date: 6, album: 8, type: 6 } as const;

/** Whether a word of `label` (or the whole label) starts with `prefix`. */
function startsWord(label: string, prefix: string): boolean {
  if (fold(label).startsWith(prefix)) return true;
  return !prefix.includes(" ") && words(label).some((w) => w.startsWith(prefix));
}

function buildCandidates(ctx: SearchContext, facts: LibraryFacts, used: ParsedQuery) {
  const usedKeys = new Set(used.terms.map(termKey));
  const people: Suggestion[] = ctx.people
    .filter((p) => p.name.trim() && !usedKeys.has(`person:${p.id}`))
    .map((p) => ({ key: `person:${p.id}`, kind: "person", label: p.name, insert: p.name, count: p.mediaIds.length, person: p }));
  const categories: Suggestion[] = ctx.categories
    .filter((c) => c.id !== VIDEOS_CATEGORY.id && c.id !== EDITED_CATEGORY.id && !usedKeys.has(`category:${c.id}`))
    .map((c) => ({ key: `category:${c.id}`, kind: "category", label: c.name, insert: c.name, count: c.count, mediaId: c.coverId }));
  const albums: Suggestion[] = ctx.albums
    .filter((a) => a.name.trim() && !usedKeys.has(`album:${a.id}`))
    .map((a) => ({ key: `album:${a.id}`, kind: "album", label: a.name, insert: a.name, count: a.mediaIds.length, mediaId: a.coverId }));
  const types: Suggestion[] = [];
  const addType = (key: string, label: string, count: number | undefined) => {
    if (count && !usedKeys.has(key)) types.push({ key, kind: "type", label, insert: label, count });
  };
  addType("type:video", "Videos", facts.types.video);
  addType("favorite", "Favorites", facts.favorites);
  addType("edited", "Edited", facts.edited);
  addType("type:selfie", "Selfies", facts.types.selfie);
  addType("type:gif", "GIFs", facts.types.gif);
  addType("type:raw", "RAW", facts.types.raw);
  addType("type:heic", "HEIC", facts.types.heic);
  addType("type:png", "PNG", facts.types.png);
  return { people, categories, albums, types, usedKeys };
}

function dateSuggestion(label: string, count?: number): Suggestion {
  return { key: `date:${label.toLowerCase()}`, kind: "date", label, insert: label, count };
}

function defaultDates(facts: LibraryFacts, usedKeys: Set<string>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const [year, month, count] of facts.months.slice(0, 3)) {
    const label = `${MONTH_LABELS[month]} ${year}`;
    const start = new Date(year, month, 1).getTime();
    if (!usedKeys.has(`range:${start}-${new Date(year, month + 1, 1).getTime()}`)) out.push(dateSuggestion(label, count));
  }
  for (const year of facts.years.slice(0, 4)) {
    const start = new Date(year, 0, 1).getTime();
    if (!usedKeys.has(`range:${start}-${new Date(year + 1, 0, 1).getTime()}`)) out.push(dateSuggestion(String(year)));
  }
  return out;
}

function prefixDates(prefix: string, facts: LibraryFacts): Suggestion[] {
  const out: Suggestion[] = [];
  const relative = ["Today", "Yesterday", "This week", "Last week", "This month", "Last month", "This year", "Last year"];
  for (const label of relative) if (fold(label).startsWith(prefix) && prefix.length >= 2) out.push(dateSuggestion(label));
  const month = MONTHS.findIndex((m) => prefix.length >= 2 && m.startsWith(prefix.replace(/\.$/, "")));
  if (month >= 0) {
    out.push(dateSuggestion(MONTH_LABELS[month]));
    for (const [year, m, count] of facts.months) {
      if (m === month) out.push(dateSuggestion(`${MONTH_LABELS[month]} ${year}`, count));
      if (out.length >= SUGGESTION_LIMITS.date) break;
    }
  }
  if (/^\d{1,4}$/.test(prefix)) {
    for (const year of facts.years) if (String(year).startsWith(prefix)) out.push(dateSuggestion(String(year)));
  }
  // "oct 2", "october 20…": a month followed by the start of a year.
  const monthYear = /^([a-z]+)\.? (\d{1,4})$/.exec(prefix);
  if (monthYear) {
    const m = monthIndex(monthYear[1]) >= 0 ? monthIndex(monthYear[1]) : MONTHS.findIndex((x) => x.startsWith(monthYear[1]));
    if (m >= 0) {
      for (const [year, mm, count] of facts.months) {
        if (mm === m && String(year).startsWith(monthYear[2])) out.push(dateSuggestion(`${MONTH_LABELS[m]} ${year}`, count));
      }
    }
  }
  return out.slice(0, SUGGESTION_LIMITS.date);
}

/**
 * Suggestions for the search box. With nothing being typed (empty, or ending in a space) it
 * offers people, categories, recent dates, albums and kinds of items; while a word is being
 * typed, the ones whose name starts with it (the last two or three words for longer names).
 */
export function suggest(query: string, ctx: SearchContext, facts: LibraryFacts): Suggestions {
  const tokens = tokenize(query);
  const typing = tokens.length > 0 && !/\s$/.test(query);
  const settled = typing ? query.slice(0, tokens[tokens.length - 1].start) : query;
  const parsed = parseQuery(settled, ctx);
  const { people, categories, albums, types, usedKeys } = buildCandidates(ctx, facts, parsed);

  if (!typing) {
    const groups: SuggestionGroup[] = [
      { title: "People", items: people.slice(0, SUGGESTION_LIMITS.person) },
      { title: "Categories", items: categories.slice(0, SUGGESTION_LIMITS.category) },
      { title: "Dates", items: defaultDates(facts, usedKeys).slice(0, SUGGESTION_LIMITS.date) },
      { title: "Albums", items: albums.slice(0, SUGGESTION_LIMITS.album) },
      { title: "Things", items: types.slice(0, SUGGESTION_LIMITS.type) },
    ];
    return { groups: groups.filter((g) => g.items.length > 0), replaceFrom: query.length };
  }

  // Try the last three, two, then one word as what's being typed; longer prefixes go first.
  for (let k = Math.min(3, tokens.length); k >= 1; k--) {
    const first = tokens[tokens.length - k];
    const prefix = tokens.slice(-k).map((t) => t.norm).join(" ");
    const match = (s: Suggestion) => startsWord(s.label, prefix);
    const groups: SuggestionGroup[] = [
      { title: "People", items: people.filter(match).slice(0, SUGGESTION_LIMITS.person) },
      { title: "Categories", items: categories.filter(match).slice(0, SUGGESTION_LIMITS.category) },
      { title: "Dates", items: prefixDates(prefix, facts) },
      { title: "Albums", items: albums.filter(match).slice(0, SUGGESTION_LIMITS.album) },
      { title: "Things", items: types.filter(match).slice(0, SUGGESTION_LIMITS.type) },
    ].filter((g) => g.items.length > 0);
    if (groups.length > 0 || k === 1) return { groups, replaceFrom: first.start };
  }
  return { groups: [], replaceFrom: query.length };
}

/** The query with a suggestion put in place of the words being typed, ready for the next word. */
export function applySuggestion(query: string, replaceFrom: number, suggestion: Pick<Suggestion, "insert">): string {
  const before = query.slice(0, replaceFrom).replace(/\s+$/, "");
  return `${before ? `${before} ` : ""}${suggestion.insert} `;
}
