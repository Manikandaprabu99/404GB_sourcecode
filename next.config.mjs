/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // No server (docs/STANDALONE.md): `next build` writes a static site to out/, which the
  // Android app bundles and serves from https://localhost, and any static host can serve.
  // Everything else — GitHub calls, sessions, thumbnails — happens in the browser.
  output: "export",
  // The image optimizer needs a server; the app only uses its own <img> elements anyway.
  images: { unoptimized: true },
};

export default nextConfig;
