/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
