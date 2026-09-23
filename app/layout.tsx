import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import Script from "next/script";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";

// Self-hosted as static files checked into app/fonts/ (Inter and JetBrains
// Mono, latin subset, variable-weight woff2) rather than next/font/google —
// this needs zero network access at build time (some CI/sandboxed build
// environments can't reach fonts.googleapis.com, e.g. behind a TLS-
// intercepting proxy) and, being served from this app's own origin either
// way, keeps working offline as an installed PWA. Exposed as CSS variables
// so globals.css/tailwind.config.js can reference `font-sans`/`font-mono`.
const inter = localFont({
  src: "./fonts/inter-latin-variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});
const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-variable.woff2",
  variable: "--font-mono",
  weight: "100 800",
  display: "swap",
});

// Phase 5 (PWA): manifest + icons are declared through Next's Metadata API
// (rather than hand-written <link> tags) — Next renders the equivalent
// <link rel="manifest">, <link rel="icon">/<link rel="apple-touch-icon">
// tags into <head> itself. theme-color lives on the separate `viewport`
// export, which is where Next.js 14 expects it (a `metadata.themeColor`
// field is deprecated in favor of this since Next 14).
export const metadata: Metadata = {
  title: "404GB",
  description: "Your phone is full. Your repo isn't.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#060609" },
  ],
};

// Runs before hydration (next/script `beforeInteractive`, which Next hoists
// into <head>) so the correct theme is already on <html> for first paint —
// avoids a light/dark flash. Mirrors ThemeToggle's own storage key/values.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("404gb-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-sans">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
