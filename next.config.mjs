/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // `sharp` (server-side thumbnail backfill — see lib/media.ts's
  // backfillThumbnailIfMissing) ships prebuilt native (.node) bindings per
  // platform. Webpack can't bundle those, so this tells Next.js's serverless
  // function bundler to leave the package external (`require`d at runtime
  // from node_modules) instead of trying to trace/bundle it — this is the
  // config key actually shipped in Next.js 14.2.5 (`serverComponentsExternalPackages`,
  // still under `experimental`); it was only promoted to the stable,
  // top-level `serverExternalPackages` key in Next.js 15.
  experimental: {
    serverComponentsExternalPackages: ["sharp"],
  },
  // Phase 5 (PWA): public/sw.js is served like any other static file under
  // public/, which by default leaves caching to Vercel's normal static-asset
  // behavior. A service worker file specifically must be re-checked by the
  // browser on every navigation so updates (new precache list, new runtime
  // strategy) roll out promptly instead of being stuck behind a long-lived
  // cache — hence the explicit no-cache header here.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
