import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "404GB",
  description: "Your phone is full. Your repo isn't.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
