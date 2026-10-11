# 404GB standalone: no server

The Vercel deployment is gone (the free plan was exhausted and the deployment is disabled).
From now on nothing of 404GB runs on a server:

- **UI**: this Next.js app is built as a static export (`output: "export"`) and bundled into
  the Android APK (Capacitor serves it from `https://localhost`). The same export can later be
  hosted on any static host (e.g. GitHub Pages) for use in a desktop browser.
- **Data**: the UI talks to the GitHub REST API directly with the user's token.
- **Background backup**: the native worker talks to the GitHub REST API directly too.

Both sides read and write the **same repo format as before**, so existing libraries keep working.

## Repo format (unchanged)

| Path | Content |
| --- | --- |
| `objects/<h[0:2]>/<h>` | raw chunk bytes, ≤ 4 MiB (4194304); `h` = sha256 hex of the chunk |
| `thumbnails/<mediaId>/<size>.webp` | `size` ∈ 320, 800, 1600 |
| `metadata/<mediaId>.json` | `MediaRecord`, written as `JSON.stringify(record, null, 2)` |
| `manifest/media-index.json` | JSON array of `MediaIndexEntry`, one entry per line (below) |
| `manifest/albums.json` | JSON array of `Album` (`lib/albums/types.ts`), same serialization |

- Types: `lib/media/types.ts` (`MediaRecord`, `MediaIndexEntry`, `toIndexEntry`, ids
  `/^media_[A-Za-z0-9_-]{1,80}$/`, `makeMediaId`). Validation/normalization of an upload record:
  `lib/media/validate.ts` (`normalizeUploadRecord`). Both clients must produce records that
  pass these rules (hash `sha256:<hex>`, mimeType `image/*`/`video/*`, chunks indexed 0..n-1 with
  `chunkSize` 4194304, `takenAt` ISO within [1900, now + 2 days], positive int width/height,
  video `duration` in seconds, `source` `"web"` or `"android-backup"`).
- Manifest serialization (`lib/github/jsonArray.ts`): empty → `"[]\n"`, otherwise
  `"[\n" + entries.map(e => "  " + JSON.stringify(e)).join(",\n") + "\n]\n"`. Keep it exactly
  this way so every commit changes only the lines that changed.
- **No duplicates**: an upload whose whole-file hash (`sha256:<hex>`) is already in the index is
  not added (the existing id is the "duplicate of"). The check is repeated inside every commit
  attempt, so two clients uploading the same file at once still produce one entry.

## Writing: the race-safe transaction (port of `lib/github/transaction.ts`)

1. `GET /repos/{o}/{r}/git/ref/heads/{branch}` → commit sha `C`.
2. `GET /repos/{o}/{r}/git/commits/{C}` → tree sha `T`.
3. Read what the change depends on **at `C`** (index, albums, records…) and build the new files.
4. `POST /repos/{o}/{r}/git/trees` `{ base_tree: T, tree: [...] }`. Each item is
   `{ path, mode: "100644", type: "blob", sha }`, or `{ …, content }` for UTF-8 text, or
   `{ …, sha: null }` to delete. Inline `content` only for text ≤ 512 KiB each and ≤ 4 MiB in
   total per request; bigger text (a large index) is created first with
   `POST /git/blobs { content, encoding: "utf-8" }`. Binary data (chunks, thumbnails) is always
   created with `POST /git/blobs { content: <base64>, encoding: "base64" }` and referenced by sha.
   A 422/404 here usually means a referenced blob sha is unknown → upload those blobs again.
5. `POST /repos/{o}/{r}/git/commits` `{ message, tree, parents: [C] }`.
6. `PATCH /repos/{o}/{r}/git/refs/heads/{branch}` `{ sha, force: false }`. A 422 ("not a
   fast forward") means someone else committed meanwhile: start again at step 1 (up to 6
   attempts, jittered backoff ~200 ms · 2ⁿ). Never force-push.

Commit messages stay as before (`404gb: upload <filename>`, `404gb: delete N items`, …).
Paths are only ever built from `[A-Za-z0-9._-]` segments.

## Reading

- Raw file at a commit: `GET /repos/{o}/{r}/contents/{path}?ref={sha}` with
  `Accept: application/vnd.github.raw` (works up to 100 MB; 404 = missing). Chunks are ≤ 4 MiB.
- Head check: `GET /repos/{o}/{r}/git/ref/heads/{branch}`; send `If-None-Match` with the last
  ETag where it helps (a 304 does not count against the rate limit).
- Every request: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json` (unless
  raw), `X-GitHub-Api-Version: 2022-11-28`. api.github.com sends CORS headers for any origin, so
  the WebView (`https://localhost`) and browsers can use `fetch` directly.
- Errors: **401** → the token is invalid or revoked (signed out). **403/429** with `Retry-After`,
  or 403 with `x-ratelimit-remaining: 0` (wait until `x-ratelimit-reset`), or a "secondary rate
  limit" message → back off and retry later. A 404 on a private repo can also mean "no access".
- Limits to respect: 5,000 REST requests/hour per token; secondary limits of roughly 80
  content-creating requests/minute and 500/hour (blobs, trees, commits, ref updates). Reads should
  be cached (IndexedDB / Cache Storage on the web side) so scrolling doesn't re-download.

## Signing in (no server, no client secret)

The token is either:

1. A GitHub **OAuth token from the Device Flow** (app only). Client id comes from
   `NEXT_PUBLIC_GITHUB_CLIENT_ID` at build time (empty → Device Flow hidden). Scope `repo`.
   `github.com/login/*` sends no CORS headers, so the app calls it with `CapacitorHttp` from
   `@capacitor/core` (native HTTP, built into Capacitor):
   - `POST https://github.com/login/device/code` `{ client_id, scope: "repo" }`,
     `Accept: application/json` → `{ device_code, user_code, verification_uri, expires_in, interval }`.
   - Show `user_code` (copy it to the clipboard), open `verification_uri` with `@capacitor/browser`.
   - Poll `POST https://github.com/login/oauth/access_token`
     `{ client_id, device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }`
     every `interval` seconds; `authorization_pending` → keep polling, `slow_down` → add 5 s,
     `expired_token` / `access_denied` → stop with a message, `device_flow_disabled` → tell the
     user to tick "Enable Device Flow" in the OAuth App settings (or use a token instead).
2. A **personal access token** pasted by the user (works everywhere, including a desktop
   browser): classic with the `repo` scope, or fine-grained with Contents read & write (+ Metadata
   read) on the photo repo. Offer a link to
   `https://github.com/settings/tokens/new?scopes=repo&description=404GB`.

After either, `GET /user` gives the login. The session is
`{ token, login, owner?, repo?, branch? }`:

- **In the app** the source of truth is native storage through the Backup plugin
  (`setAuth` / `getAuth` / `clearAuth`), so the background worker uses the same token.
- **In a browser** it is `localStorage`.
- The page also mirrors `{ token, owner, repo, branch }` into IndexedDB (database `404gb-auth`,
  store `auth`, key `current`) so the service worker can fetch chunks for video streaming;
  cleared on sign-out.

A 401 anywhere → drop the token (keep login/owner/repo so signing in again returns to the same
library) and show the sign-in screen with "Your GitHub sign-in ended". There is no way to revoke a
Device Flow token without the client secret; signing out only forgets it on this device.

## Backup plugin (`lib/native/backup.ts`) changes

```ts
export interface BackupAuth { token: string; login: string; owner: string; repo: string; branch: string }
setAuth(options: BackupAuth): Promise<BackupStatus>;   // store; if owner/repo changed, reset the ledger; kick backup if enabled
getAuth(): Promise<{ auth: BackupAuth | null }>;
clearAuth(): Promise<BackupStatus>;                    // forget the token; state becomes "needs_sign_in"; ledger kept
addListener("itemsUploaded", (event: { entries: MediaIndexEntry[] }) => void)
```

- `setLibrary` is removed (`setAuth` covers it).
- `needs_sign_in` now means "no token stored, or GitHub answered 401".
- `itemsUploaded` carries the index entries the worker just committed, so the open gallery can
  show them at once instead of re-downloading the whole index after every upload.
- `saveToDevice` / `shareMedia` fetch the record and chunks from GitHub with the stored token.

## Building the APK

The mobile repo's CI checks out this repo (public) at the branch with the same name as the
mobile branch being built, falling back to `main`; runs `npm ci && npm run build` with
`NEXT_PUBLIC_GITHUB_CLIENT_ID` set from the mobile repo's `config/github-client-id` file; copies
`out/` to the mobile project's `www/`; then `npx cap sync android` and Gradle.
`capacitor.config.json` has no `server.url` any more.

Capacitor's local server answers any path **without** a file extension with the root
`index.html` (html5mode). So in the app, full page loads must go to `/` (navigate between
screens with the Next router; a full load of a deep path just shows the home screen, which then
routes onward). Files with extensions (`/_next/…`, `*.txt` RSC payloads, `/sw.js`) are served as
they are, and service worker requests are resolved by the local server too.
