// Settings › Appearance: theme, accent, font and Pure black, each one <html> attribute
// (data-theme, data-accent, data-font, data-black) and one localStorage key.

export type ThemePreference = "light" | "dark" | "system";
export type AccentId = "blue" | "indigo" | "violet" | "teal" | "green" | "orange" | "rose" | "graphite";
export type FontId = "geist" | "inter" | "jakarta" | "manrope" | "system";

export interface Appearance {
  theme: ThemePreference;
  accent: AccentId;
  font: FontId;
  black: boolean;
}

export const STORAGE_KEYS = {
  theme: "404gb-theme",
  accent: "404gb-accent",
  font: "404gb-font",
  black: "404gb-black",
} as const;

export const DEFAULT_APPEARANCE: Appearance = { theme: "system", accent: "blue", font: "geist", black: false };

/** The swatch colours are the dark and light fills from globals.css. */
export const ACCENTS: { id: AccentId; name: string; dark: string; light: string }[] = [
  { id: "blue", name: "Sapphire", dark: "rgb(39 109 246)", light: "rgb(22 96 235)" },
  { id: "indigo", name: "Indigo", dark: "rgb(88 86 230)", light: "rgb(79 70 229)" },
  { id: "violet", name: "Violet", dark: "rgb(139 76 230)", light: "rgb(124 58 237)" },
  { id: "teal", name: "Lagoon", dark: "rgb(13 128 120)", light: "rgb(15 118 110)" },
  { id: "green", name: "Emerald", dark: "rgb(4 128 90)", light: "rgb(4 120 87)" },
  { id: "orange", name: "Sunset", dark: "rgb(209 70 10)", light: "rgb(194 65 12)" },
  { id: "rose", name: "Rose", dark: "rgb(214 26 70)", light: "rgb(190 18 60)" },
  { id: "graphite", name: "Graphite", dark: "rgb(228 230 236)", light: "rgb(30 33 40)" },
];

/** `family` is the CSS font-family used for the preview cards. */
export const FONTS: { id: FontId; name: string; note: string; family: string }[] = [
  { id: "geist", name: "Geist", note: "Crisp and modern", family: "var(--font-geist), system-ui, sans-serif" },
  { id: "inter", name: "Inter", note: "Classic and neutral", family: "var(--font-inter), system-ui, sans-serif" },
  { id: "jakarta", name: "Plus Jakarta Sans", note: "Warm and rounded", family: "var(--font-jakarta), system-ui, sans-serif" },
  { id: "manrope", name: "Manrope", note: "Geometric and airy", family: "var(--font-manrope), system-ui, sans-serif" },
  { id: "system", name: "Device font", note: "No download", family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
];

/** The --bg tokens, for theme-color and the Android system bars. */
export const BG_COLORS = { light: "#f6f7f9", dark: "#07080b", black: "#000000" } as const;

const ACCENT_IDS = new Set<string>(ACCENTS.map((a) => a.id));
const FONT_IDS = new Set<string>(FONTS.map((f) => f.id));

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // Storage blocked: defaults.
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Still applies for this visit, it just won't persist.
  }
}

export function getAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  const theme = read(STORAGE_KEYS.theme);
  const accent = read(STORAGE_KEYS.accent);
  const font = read(STORAGE_KEYS.font);
  return {
    theme: theme === "light" || theme === "dark" ? theme : "system",
    accent: accent && ACCENT_IDS.has(accent) ? (accent as AccentId) : "blue",
    font: font && FONT_IDS.has(font) ? (font as FontId) : "geist",
    black: read(STORAGE_KEYS.black) === "true",
  };
}

export function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** The theme on screen right now. */
export function resolvedTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return systemTheme();
}

/** The page background on screen right now (theme-color, Android bars). */
export function currentBgColor(): string {
  const root = document.documentElement;
  if (resolvedTheme() === "light") return BG_COLORS.light;
  return root.getAttribute("data-black") === "true" ? BG_COLORS.black : BG_COLORS.dark;
}

function setAttr(name: string, value: string | null) {
  const root = document.documentElement;
  if (value === null) {
    if (root.hasAttribute(name)) root.removeAttribute(name);
  } else if (root.getAttribute(name) !== value) {
    root.setAttribute(name, value);
  }
}

/** Puts the choices on <html>; a theme change can cross-fade with a view transition. */
export function applyAppearance(appearance: Appearance, { animate = false }: { animate?: boolean } = {}) {
  const root = document.documentElement;
  const theme = appearance.theme === "system" ? systemTheme() : appearance.theme;
  const run = () => {
    setAttr("data-theme", theme);
    setAttr("data-accent", appearance.accent === "blue" ? null : appearance.accent);
    setAttr("data-font", appearance.font === "geist" ? null : appearance.font);
    setAttr("data-black", appearance.black ? "true" : null);
  };
  const themeChanges = root.getAttribute("data-theme") !== theme;
  type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
  const doc = document as Document & { startViewTransition?: (update: () => void) => Transition };
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate && themeChanges && typeof doc.startViewTransition === "function" && !reduceMotion) {
    // A quick second switch skips the first transition; its promises then reject.
    const transition = doc.startViewTransition(run);
    for (const promise of [transition?.ready, transition?.finished, transition?.updateCallbackDone]) promise?.catch(() => {});
  } else {
    run();
  }
}

type Listener = (appearance: Appearance) => void;
const listeners = new Set<Listener>();

function notify() {
  const current = getAppearance();
  listeners.forEach((listener) => listener(current));
}

/** Stores, applies and announces a change (e.g. `setAppearance({ accent: "teal" })`). */
export function setAppearance(patch: Partial<Appearance>) {
  const next = { ...getAppearance(), ...patch };
  if (patch.theme !== undefined) write(STORAGE_KEYS.theme, next.theme === "system" ? null : next.theme);
  if (patch.accent !== undefined) write(STORAGE_KEYS.accent, next.accent === "blue" ? null : next.accent);
  if (patch.font !== undefined) write(STORAGE_KEYS.font, next.font === "geist" ? null : next.font);
  if (patch.black !== undefined) write(STORAGE_KEYS.black, next.black ? "true" : null);
  applyAppearance(next, { animate: patch.theme !== undefined });
  notify();
}

/** Calls `listener` on changes here, in other tabs, or of the OS theme under "system". */
export function subscribeAppearance(listener: Listener): () => void {
  listeners.add(listener);
  const keys = new Set<string>(Object.values(STORAGE_KEYS));
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !keys.has(event.key)) return;
    const current = getAppearance();
    applyAppearance(current);
    listener(current);
  };
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const onMedia = () => {
    const current = getAppearance();
    if (current.theme !== "system") return;
    applyAppearance(current, { animate: true });
    listener(current);
  };
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onMedia);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onMedia);
  };
}

/** Inline <head> script (app/layout.tsx): applies the stored choices before first paint. */
export const APPEARANCE_INIT_SCRIPT = `(function(){var d=document.documentElement;function g(k){try{return localStorage.getItem(k)}catch(e){return null}}var t=g("${STORAGE_KEYS.theme}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}d.setAttribute("data-theme",t);var a=g("${STORAGE_KEYS.accent}");if(a&&/^(${ACCENTS.filter((x) => x.id !== "blue").map((x) => x.id).join("|")})$/.test(a))d.setAttribute("data-accent",a);var f=g("${STORAGE_KEYS.font}");if(f&&/^(${FONTS.filter((x) => x.id !== "geist").map((x) => x.id).join("|")})$/.test(f))d.setAttribute("data-font",f);if(g("${STORAGE_KEYS.black}")==="true")d.setAttribute("data-black","true");try{var c=t==="light"?"${BG_COLORS.light}":d.getAttribute("data-black")==="true"?"${BG_COLORS.black}":"${BG_COLORS.dark}";var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c)}catch(e){}})();`;
