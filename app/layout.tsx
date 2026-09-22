import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";

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
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
