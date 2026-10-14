/** @type {import('tailwindcss').Config} */
const plugin = require("tailwindcss/plugin");

// Capacitor injects --safe-area-inset-* inside the Android app; browsers provide env().
const safeInset = (side) =>
  `var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`;

module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  // Hover styles only apply on devices that can really hover, so they don't
  // stick after a tap on phones.
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Design tokens live as CSS custom properties (app/globals.css) so a
      // single class (e.g. bg-surface) works in both light and dark theme
      // without a `dark:` variant on every element. See globals.css for the
      // `rgb r g b` triples these reference and how the light/dark switch
      // (prefers-color-scheme + a localStorage override) sets them, and
      // docs/DESIGN.md for what each one is for.
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--surface-3) / <alpha-value>)",
        border: {
          DEFAULT: "rgb(var(--border) / <alpha-value>)",
          strong: "rgb(var(--border-strong) / <alpha-value>)",
        },
        ink: {
          DEFAULT: "rgb(var(--ink) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          // Below 4.5:1 for small text: placeholders, separators, non-essential text.
          faint: "rgb(var(--ink-faint) / <alpha-value>)",
        },
        // Old name of the accent fill (Lumen aliases --signal to --accent).
        signal: {
          DEFAULT: "rgb(var(--signal) / <alpha-value>)",
          ink: "rgb(var(--signal-ink) / <alpha-value>)",
        },
        // The chosen accent: `accent` fill with `accent-ink` on it, `accent-text` for text
        // on bg/surface, `accent-soft` a tinted fill.
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          strong: "rgb(var(--accent-strong) / <alpha-value>)",
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
          text: "rgb(var(--accent-text) / <alpha-value>)",
          soft: "rgb(var(--accent-soft) / <alpha-value>)",
          // Readable accent on the opposite theme's surface (inverted bars).
          inverse: "rgb(var(--accent-inverse) / <alpha-value>)",
        },
        // The fixed secondary for people and faces.
        "accent-2": "rgb(var(--accent-2) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        danger: {
          DEFAULT: "rgb(var(--danger) / <alpha-value>)",
          // Text/icon color on a solid bg-danger surface.
          ink: "rgb(var(--danger-ink) / <alpha-value>)",
        },
        warning: "rgb(var(--warning) / <alpha-value>)",
        // Same in both themes: used on the always-dark viewer and on thumbnails.
        favorite: "rgb(251 113 133 / <alpha-value>)",
        glow: {
          DEFAULT: "rgb(var(--glow) / <alpha-value>)",
          // Legacy names, now the accent and the people colour.
          sky: "rgb(var(--glow) / <alpha-value>)",
          fuchsia: "rgb(var(--accent-2) / <alpha-value>)",
        },
      },
      // One family for everything (`display` aliases `sans`); `mono` is for code-like values.
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // Lumen type roles, then the old role names as aliases of them.
      fontSize: {
        "large-title": ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        "large-title-desktop": ["2.125rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        title: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em", fontWeight: "650" }],
        headline: ["1.0625rem", { lineHeight: "1.375rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.375rem" }],
        callout: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "500" }],
        footnote: ["0.8125rem", { lineHeight: "1.125rem" }],
        caption: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.01em", fontWeight: "550" }],
        // Aliases (old role -> Lumen role).
        display: ["2.125rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        h1: ["2rem", { lineHeight: "2.375rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        h2: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.015em", fontWeight: "650" }],
        h3: ["1.0625rem", { lineHeight: "1.375rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-lg": ["1rem", { lineHeight: "1.5rem" }],
        small: ["0.8125rem", { lineHeight: "1.125rem" }],
        micro: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
        // Was the uppercase mono label; now a sentence-case caption.
        label: ["0.75rem", { lineHeight: "1rem", letterSpacing: "0.01em", fontWeight: "550" }],
      },
      borderRadius: {
        sm: "0.5rem",
        DEFAULT: "0.625rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.25rem",
        "2xl": "1.75rem",
        // docs/DESIGN.md › Shape: tiles 4, controls 14, cards 22, hero 26, sheets 28.
        thumb: "4px",
        "tile-sm": "8px",
        tile: "10px",
        control: "14px",
        card: "22px",
        hero: "26px",
        nav: "32px",
        dialog: "22px",
        sheet: "28px",
      },
      // Stacking order for app-level layers. Toasts sit above everything so
      // feedback stays visible over the viewer, editor, sheets and dialogs.
      zIndex: {
        nav: "40",
        viewer: "50",
        editor: "65",
        sheet: "85",
        dialog: "90",
        toast: "100",
      },
      boxShadow: {
        // Light theme depth: two soft layers. Dark uses the card highlight instead.
        soft: "0 1px 2px rgb(15 20 30 / 0.06), 0 8px 24px rgb(15 20 30 / 0.06)",
        elevated: "0 2px 8px rgb(0 0 0 / 0.12), 0 18px 44px -18px rgb(0 0 0 / 0.45)",
        "glow-accent": "0 0 0 1px rgb(var(--accent) / 0.35), 0 8px 28px -8px rgb(var(--accent) / 0.5)",
        "glow-signal": "0 8px 24px -10px rgb(var(--accent) / 0.6)",
        "inset-hairline": "inset 0 1px 0 0 rgb(255 255 255 / 0.06)",
        sheet: "0 -8px 40px -12px rgb(0 0 0 / 0.45)",
      },
      transitionTimingFunction: {
        // A gentle overshoot-free ease-out ("expo-out") used for most moves, a
        // springy curve for small knobs (switch, checks) and a softer one for
        // the nav tile, which travels further.
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        // docs/DESIGN.md › Motion: the standard iOS-like sheet curve (380ms).
        lumen: "cubic-bezier(0.32, 0.72, 0, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "spring-soft": "cubic-bezier(0.3, 1.25, 0.5, 1)",
      },
      transitionDuration: {
        120: "120ms",
        160: "160ms",
        180: "180ms",
        200: "200ms",
        240: "240ms",
        250: "250ms",
        320: "320ms",
        340: "340ms",
        360: "360ms",
        380: "380ms",
      },
      transitionDelay: {
        160: "160ms",
        200: "200ms",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        // Only a `to` frame: exits start from wherever the element currently is.
        "fade-out": { to: { opacity: 0 } },
        "fade-in-up": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        // Screen enter: fade + 8px rise.
        "page-in": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "none" },
        },
        "scale-in": {
          from: { opacity: 0, transform: "scale(0.96)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        "scale-out": { to: { opacity: 0, transform: "scale(0.96)" } },
        "slide-in": {
          from: {
            opacity: 0,
            transform: "translateX(calc(var(--slide-dir, 0) * 28px)) scale(0.98)",
          },
          to: { opacity: 1, transform: "translateX(0) scale(1)" },
        },
        "sheet-in": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "sheet-out": { to: { transform: "translateY(100%)" } },
        "toast-in": {
          from: { opacity: 0, transform: "translateY(12px) scale(0.98)" },
          to: { opacity: 1, transform: "translateY(0) scale(1)" },
        },
        "toast-out": { to: { opacity: 0, transform: "translateY(8px) scale(0.98)" } },
        "viewer-in": {
          from: { opacity: 0, transform: "scale(0.94)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        "viewer-out": { to: { opacity: 0, transform: "scale(0.86)" } },
        pop: {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.28)" },
          "100%": { transform: "scale(1)" },
        },
        // The missing tile filling in: the nav tile after it slides, the brand mark on
        // the sign-in screen.
        "tile-fill": {
          from: { opacity: 0, transform: "scale(0.55)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        // The progress tile being filled.
        "tile-pulse": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.45 },
        },
        // The empty state's dashed tile.
        breathe: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
        // One tile of the status badge's 2×2 glyph; staggered delays make them fill in turn.
        "tile-step": {
          "0%, 100%": { opacity: 0.28 },
          "25%, 55%": { opacity: 1 },
        },
        // Square selection check.
        "check-pop": {
          from: { opacity: 0, transform: "scale(0.6)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        indeterminate: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(250%)" },
        },
        blob: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(3%, -4%) scale(1.08)" },
          "66%": { transform: "translate(-2%, 3%) scale(0.95)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms var(--tw-ease, cubic-bezier(0.16,1,0.3,1)) both",
        "fade-out": "fade-out 180ms ease-in forwards",
        "fade-in-up": "fade-in-up 320ms cubic-bezier(0.16,1,0.3,1) both",
        // `backwards`: no transform is left behind, so fixed-position children keep the viewport.
        "page-in": "page-in 240ms cubic-bezier(0.16,1,0.3,1) backwards",
        "scale-in": "scale-in 180ms cubic-bezier(0.16,1,0.3,1) both",
        "scale-out": "scale-out 160ms ease-in forwards",
        "slide-in": "slide-in 220ms cubic-bezier(0.16,1,0.3,1) both",
        // `backwards`, not `both`: once finished, inline drag transforms must win.
        "sheet-in": "sheet-in 380ms cubic-bezier(0.32,0.72,0,1) backwards",
        "sheet-out": "sheet-out 220ms cubic-bezier(0.4,0,1,1) forwards",
        "toast-in": "toast-in 260ms cubic-bezier(0.16,1,0.3,1) backwards",
        "toast-out": "toast-out 180ms ease-in forwards",
        "viewer-in": "viewer-in 260ms cubic-bezier(0.16,1,0.3,1) both",
        "viewer-out": "viewer-out 220ms cubic-bezier(0.4,0,1,1) forwards",
        pop: "pop 360ms cubic-bezier(0.34,1.56,0.64,1)",
        "tile-fill": "tile-fill 160ms cubic-bezier(0.16,1,0.3,1) both",
        "tile-pulse": "tile-pulse 1.2s ease-in-out infinite",
        breathe: "breathe 2.4s ease-in-out infinite",
        "tile-step": "tile-step 1.6s ease-in-out infinite",
        "check-pop": "check-pop 240ms cubic-bezier(0.34,1.56,0.64,1) both",
        indeterminate: "indeterminate 1.2s cubic-bezier(0.65,0,0.35,1) infinite",
        blob: "blob 20s ease-in-out infinite",
      },
    },
  },
  plugins: [
    // Safe-area spacing that adds to a base value instead of replacing it:
    // `pt-safe` = inset only, `pt-safe-4` = 1rem + inset (any spacing key).
    plugin(({ matchUtilities, theme }) => {
      const values = { DEFAULT: "0px", ...theme("spacing") };
      const plus = (value, side) => `calc(${value} + ${safeInset(side)})`;
      matchUtilities(
        {
          "pt-safe": (value) => ({ paddingTop: plus(value, "top") }),
          "pb-safe": (value) => ({ paddingBottom: plus(value, "bottom") }),
          "pl-safe": (value) => ({ paddingLeft: plus(value, "left") }),
          "pr-safe": (value) => ({ paddingRight: plus(value, "right") }),
          "px-safe": (value) => ({
            paddingLeft: plus(value, "left"),
            paddingRight: plus(value, "right"),
          }),
          "top-safe": (value) => ({ top: plus(value, "top") }),
          "bottom-safe": (value) => ({ bottom: plus(value, "bottom") }),
          "left-safe": (value) => ({ left: plus(value, "left") }),
          "right-safe": (value) => ({ right: plus(value, "right") }),
          "mb-safe": (value) => ({ marginBottom: plus(value, "bottom") }),
        },
        { values }
      );
    }),
  ],
};
