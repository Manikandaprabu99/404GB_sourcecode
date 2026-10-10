import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import NativeAuthHandler from "./components/NativeAuthHandler";
import SystemBarsSync from "./components/SystemBarsSync";
import { ToastProvider } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";

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

export const metadata: Metadata = {
  title: { default: "404GB", template: "%s · 404GB" },
  description: "Your phone is full. Your repo isn't.",
  applicationName: "404GB",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/brand.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "404GB", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

// theme-color follows the OS here; SystemBarsSync rewrites it when the user
// picks a theme in the app, and while the photo viewer is open.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#060609" },
  ],
};

// Inline in <head> so it runs before the first paint (no light/dark flash).
// Mirrors ThemeToggle's storage key and values.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("404gb-theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;

// The browser fires beforeinstallprompt once, often before hydration; keep it for
// InstallPrompt (window.__404gbInstallPrompt + a "404gb:installprompt" event).
const INSTALL_CAPTURE_SCRIPT = `(function(){function n(){window.dispatchEvent(new Event("404gb:installprompt"))}window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__404gbInstallPrompt=e;n()});window.addEventListener("appinstalled",function(){window.__404gbInstallPrompt=null;n()})})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <ServiceWorkerRegister />
        <NativeAuthHandler />
        <SystemBarsSync />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
