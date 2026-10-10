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
      // (prefers-color-scheme + a localStorage override) sets them.
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
          faint: "rgb(var(--ink-faint) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          strong: "rgb(var(--accent-strong) / <alpha-value>)",
          ink: "rgb(var(--accent-ink) / <alpha-value>)",
          // Readable accent on inverted surfaces (toasts use bg-ink).
          inverse: "rgb(var(--accent-inverse) / <alpha-value>)",
        },
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
          sky: "rgb(56 189 248 / <alpha-value>)",
          fuchsia: "rgb(232 121 249 / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      // A deliberate type scale (name -> [size, {lineHeight, letterSpacing}])
      // instead of ad hoc text-2xl/text-sm sprinkled per page. Tighter
      // letter-spacing at large sizes and looser at small sizes mirrors the
      // scale used by Linear/Vercel's own type systems.
      fontSize: {
        display: ["2.75rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        h1: ["2.125rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        h2: ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        h3: ["1.1875rem", { lineHeight: "1.3", letterSpacing: "-0.01em" }],
        "body-lg": ["1.0625rem", { lineHeight: "1.6" }],
        body: ["0.9375rem", { lineHeight: "1.55" }],
        small: ["0.8125rem", { lineHeight: "1.45" }],
        micro: ["0.6875rem", { lineHeight: "1.3", letterSpacing: "0.02em" }],
      },
      borderRadius: {
        sm: "0.5rem",
        DEFAULT: "0.625rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.25rem",
        "2xl": "1.75rem",
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
        // Dark surfaces barely show a drop shadow, so elevation reads mostly
        // through the surface/surface-2/surface-3 lightness steps in
        // globals.css. These are a light finishing touch, not the primary
        // depth cue.
        soft: "0 1px 2px rgb(0 0 0 / 0.06), 0 8px 24px -12px rgb(0 0 0 / 0.35)",
        elevated: "0 2px 6px rgb(0 0 0 / 0.12), 0 16px 40px -16px rgb(0 0 0 / 0.45)",
        "glow-accent": "0 0 0 1px rgb(var(--accent) / 0.4), 0 8px 28px -8px rgb(var(--accent) / 0.45)",
        "inset-hairline": "inset 0 1px 0 0 rgb(255 255 255 / 0.06)",
        sheet: "0 -8px 40px -12px rgb(0 0 0 / 0.45)",
      },
      transitionTimingFunction: {
        // A gentle overshoot-free ease-out ("expo-out") used for most
        // enter/hover motion, and a slight-spring curve reserved for small
        // playful taps (switches, buttons).
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      transitionDuration: {
        120: "120ms",
        180: "180ms",
        250: "250ms",
        320: "320ms",
      },
      keyframes: {
        "fade-in": { from: { opacity: 0 }, to: { opacity: 1 } },
        // Only a `to` frame: exits start from wherever the element currently is.
        "fade-out": { to: { opacity: 0 } },
        "fade-in-up": {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
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
        "scale-in": "scale-in 180ms cubic-bezier(0.16,1,0.3,1) both",
        "scale-out": "scale-out 160ms ease-in forwards",
        "slide-in": "slide-in 220ms cubic-bezier(0.16,1,0.3,1) both",
        // `backwards`, not `both`: once finished, inline drag transforms must win.
        "sheet-in": "sheet-in 320ms cubic-bezier(0.16,1,0.3,1) backwards",
        "sheet-out": "sheet-out 220ms cubic-bezier(0.4,0,1,1) forwards",
        "toast-in": "toast-in 260ms cubic-bezier(0.16,1,0.3,1) backwards",
        "toast-out": "toast-out 180ms ease-in forwards",
        "viewer-in": "viewer-in 260ms cubic-bezier(0.16,1,0.3,1) both",
        "viewer-out": "viewer-out 220ms cubic-bezier(0.4,0,1,1) forwards",
        pop: "pop 360ms cubic-bezier(0.34,1.56,0.64,1)",
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
