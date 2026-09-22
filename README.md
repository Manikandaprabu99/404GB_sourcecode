# 404GB — Web (Phase 1)

Personal photo gallery that stores media as chunked, content-addressed objects
in a GitHub repo. This is the Phase 1 slice: GitHub OAuth login, a repo
picker/init flow, uploading a single image end-to-end (chunk → dedup-check →
upload missing chunks → single commit via the Git Data API), and a minimal
gallery that reconstructs and displays that image. See `../../docs/ARCHITECTURE.md`
for the full design.

## 1. Register a GitHub OAuth App

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Homepage URL**: `http://localhost:3000`
3. **Authorization callback URL**: `http://localhost:3000/api/auth/github/callback`
4. Save, then copy the **Client ID** and generate a **Client Secret**.

## 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.local.example .env.local
```

```
GITHUB_CLIENT_ID=...        # from the OAuth App
GITHUB_CLIENT_SECRET=...    # from the OAuth App — server-side only, never sent to the client
SESSION_SECRET=...          # any random string, 32+ characters (e.g. `openssl rand -base64 32`)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`.env.local` is gitignored — never commit real secrets.

## 3. Install & run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, click **Connect GitHub**, authorize the `repo`
scope, then pick or create a storage repo, upload a photo, and view it in the
gallery.

## What's implemented (Phase 1 scope only)

- OAuth login/callback/logout with the GitHub access token kept only in an
  encrypted, httpOnly `iron-session` cookie (never in the browser bundle,
  localStorage, or IndexedDB).
- Repo picker (`/repos`) listing the user's GitHub repos via `@octokit/rest`,
  plus an init action that creates `manifest/media-index.json` (`[]`) and
  `manifest/albums.json` (`[]`) in the chosen/new repo.
- Single-image upload (`/upload`): client-side SHA-256 of the whole file and
  of each 5 MiB (configurable) chunk, a server check of which chunk objects
  already exist at `objects/<hash[0:2]>/<hash>`, upload of only the missing
  chunks, and one Git Data API commit (blobs → tree → commit → ref update)
  covering the new chunk objects, `metadata/<id>.json`, and the updated
  `manifest/media-index.json`.
- Minimal gallery (`/gallery`) that reads the index and metadata and
  reconstructs the image server-side from its chunks (with a SHA-256
  integrity check) for display.

Out of scope for this phase (see architecture doc's later phases): gallery
grid polish, video support, PWA/offline, IndexedDB caching, and albums.

## Module layout

- `lib/chunking` — storage-engine-ish module: client-side SHA-256 hashing and
  fixed-size chunk splitting.
- `lib/github` — github-adapter-ish module: all `@octokit/rest` / Git Data API
  calls (repo listing/init, blob/tree/commit creation, Contents API lookups).
- `lib/media` — metadata/manifest read-write helpers and chunk-based image
  reconstruction.
- `lib/session` — `iron-session` wrapper for the encrypted session cookie.
- `app/api/**` — API routes per the architecture doc's Section 7.
