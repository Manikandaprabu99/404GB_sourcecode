# 404GB — Web

Personal photo gallery that stores media as chunked, content-addressed objects in a GitHub
repo you own. There is no server: this Next.js app is a static export that talks to the
GitHub REST API directly with your token. The Android app bundles the same export; a
desktop browser can use it from any static host. See [`docs/STANDALONE.md`](docs/STANDALONE.md)
for the design and the repo format shared with the Android backup worker.

## Configure (optional)

```
NEXT_PUBLIC_GITHUB_CLIENT_ID=   # OAuth App client id for "Sign in with GitHub" (Device Flow, app only)
```

Without it the app offers only personal-access-token sign-in, which works everywhere. The
OAuth App needs **Enable Device Flow** ticked; no client secret is used anywhere.

## Build & run

```bash
npm install
npm run build      # static site in out/
npx serve out      # or any static server; `npm run dev` for development
```

Open the site, sign in with a personal access token (classic with the `repo` scope, or
fine-grained with Contents read & write + Metadata read on your photo repo), then pick or
create a storage repo.

## Module layout

- `lib/github` — fetch-based GitHub client, repo reader and the race-safe commit transaction.
- `lib/media` — the library operations (index sync, uploads, favorites, deletes, thumbnail
  backfill), verified chunk reads and client-side reconstruction of originals.
- `lib/albums` — `manifest/albums.json` reads and edits.
- `lib/session` — the session store (native Backup plugin in the app, localStorage in a
  browser) and its IndexedDB mirror for the service worker.
- `lib/auth` — Device Flow (via CapacitorHttp) and token checks.
- `lib/library`, `lib/upload`, `lib/cache` — the UI's stores, upload queue and local caches.
- `public/sw.js` — offline shell and byte-range video streaming straight from GitHub.
