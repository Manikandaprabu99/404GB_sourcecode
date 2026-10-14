import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import SystemBarsSync from "./components/SystemBarsSync";
import { ToastProvider } from "./components/ui/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import { APPEARANCE_INIT_SCRIPT } from "@/lib/ui/appearance";

// OFL variable fonts in app/fonts (no network at build time); globals.css maps
// html[data-font] to --font-sans, so only the chosen face is downloaded.
const geist = localFont({
  src: "./fonts/geist-var.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});
const inter = localFont({
  // Has the optical-size axis, so titles get Inter Display automatically.
  src: "./fonts/inter-latin-var.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  preload: false,
});
const jakarta = localFont({
  src: "./fonts/plusjakartasans-latin-var.woff2",
  variable: "--font-jakarta",
  weight: "200 800",
  display: "swap",
  preload: false,
});
const manrope = localFont({
  src: "./fonts/manrope-latin-var.woff2",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
  preload: false,
});
// Only for code-like values (the device code, a commit sha).
const geistMono = localFont({
  src: "./fonts/geistmono-var.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
  preload: false,
  // An Arial-shaped fallback would be the wrong width for a monospace face.
  adjustFontFallback: false,
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
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

// The OS default; the head script and SystemBarsSync set it to the actual page background.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#07080b" },
  ],
};


// The browser fires beforeinstallprompt once, often before hydration; keep it for
// InstallPrompt (window.__404gbInstallPrompt + a "404gb:installprompt" event).
const INSTALL_CAPTURE_SCRIPT = `(function(){function n(){window.dispatchEvent(new Event("404gb:installprompt"))}window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__404gbInstallPrompt=e;n()});window.addEventListener("appinstalled",function(){window.__404gbInstallPrompt=null;n()})})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${inter.variable} ${jakarta.variable} ${manrope.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Before the first paint: theme, accent, font and Pure black (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_CAPTURE_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans">
        <ServiceWorkerRegister />
        <SystemBarsSync />
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
