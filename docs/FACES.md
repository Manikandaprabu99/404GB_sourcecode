# People: on-device face grouping

404GB finds faces in your photos **on your own device**, groups them into people you can name,
merge, correct and hide, and shows them on the Albums screen and in search. No photo, face or
signature is ever sent to any service: the model runs in the app (or browser), and the results
are saved next to your photos in your own repo so your other devices don't redo the work.

## Engine

| | |
| --- | --- |
| Library | [`@vladmandic/face-api`](https://github.com/vladmandic/face-api) **1.7.15** (MIT), TensorFlow.js 4.22 bundled inside it |
| Detector | Tiny Face Detector, 190 KB, run twice: input 512 (small faces in group shots) and 224 (close-ups the 512 pass misses), merged by overlap (IoU > 0.3); score ≥ 0.5; faces under 20 px dropped; at most 24 per photo |
| Landmarks | 68-point tiny model, 77 KB (aligns the face crop) |
| Recognition | ResNet-34 face descriptor, 6.4 MB, 128 numbers per face |
| WASM | `@tensorflow/tfjs-backend-wasm` **4.22.0** (Apache-2.0): plain + SIMD binaries, 0.7 MB (threaded build not shipped: it needs cross-origin isolation) |

- `scripts/copy-face-assets.mjs` runs as `prebuild`/`predev` and copies the six model files to
  `public/faces/models/` and the two WASM binaries to `public/faces/wasm/` (gitignored, so no
  binaries are committed; CI's `npm ci && npm run build` produces them). It fails the build if
  the WASM package version differs from the TensorFlow.js version bundled in face-api.
- The model runs in a **Web Worker** (`lib/faces/faces.worker.ts`) with OffscreenCanvas. Backends
  are tried in order **WebGL → WASM → CPU**; if a GPU returns invalid numbers (NaN) the worker
  switches to the next backend for good. Settings shows which one is used.
- Nothing of this is in the main bundle: `PeopleScanner` (mounted in the tab shell) imports
  `lib/faces/scanner` 4 s after the first screen, and the scanner creates the worker only when a
  photo needs scanning. The worker chunk (face-api + TF.js) is ~1.3 MB and is disposed after a
  minute without work. On a static web host the worker keeps the model files in Cache Storage
  (`404gb-faces-models-v1`); in the app they are local files anyway.
- APK size: +8.4 MB of files in `www/` (7.1 MB models/WASM + 1.3 MB JS), about **+4.7 MB**
  compressed.
- Measured on the face-api demo photos (real model, headless Chromium): two photos of the same
  person are typically 0.10–0.30 apart (worst 0.47 after heavy edits); different people at
  least 0.32 (1 % under 0.36). That's where the thresholds below come from.

## What gets scanned, and when

- **Images with a stored thumbnail**, not in Trash (thumbnails are always WebP, so everything
  that has one can be decoded); videos and items without thumbnails are skipped (an item gets
  scanned once the gallery backfills its thumbnail).
- **Newest first**, from the thumbnail: 800 px preferred, 320 px fallback; copies already in
  this device's thumbnail cache (IndexedDB) first. Downloaded thumbnails are *not* added to the
  cache, so scanning thousands of photos doesn't fill the device.
- **Network budget**: at most **600 thumbnail downloads per hour** (and 30 per minute) per
  library, shared by all tabs (sliding window in `localStorage`), out of GitHub's 5,000 API
  calls/hour. While downloads must wait (budget used, offline, GitHub rate limit, or a metered
  connection without "Use mobile data"), photos whose thumbnails are on the device are still
  scanned.
- **Pauses** while the app is hidden, while web uploads / phone backup / a library sync run,
  for 1.2 s after any touch, scroll or key press, when the user pauses it in Settings, when
  `faces.json` was written by another model version, and while the phone's background run (below)
  is still finishing. After each photo it rests at least as long as the photo took (≥ 250 ms),
  then waits for an idle moment. One tab scans at a time (Web Locks).
- Before scanning, the latest `faces.json` is read so photos another device already did are
  skipped. A photo the model can't read is remembered as failed on this device.
- **Re-scan** (Settings) forgets this device's failures and cached results and checks again every
  photo that has no faces line yet. Names and corrections are untouched.

## Background

In the Android app, matching also goes on while the phone **charges with the app closed** (mobile
repo: `FaceScanWorker`, `FaceRunnerHost`, `FaceRunnerAssets`). The switch is
`Backup.setFaceScan({ enabled })` (on by default); `getFaceScanStatus()` gives
`{ enabled, running, lastRunAt, lastChecked, lastError }`.

- **When**: WorkManager, about hourly, while charging with the battery not low and online (Wi-Fi
  when backup is Wi-Fi only), once a session with a library is stored. Never while the app is on
  screen; a run is stopped when the app comes to the foreground, the phone is unplugged, the switch
  is turned off or the user signs out. At most 20 minutes per run (9 when Android refuses the
  foreground notification "Finding people in your photos").
- **Page**: the export's `runner/faces.html`, from `https://appassets.androidplatform.net`, in a
  WebView that is never on screen: no Capacitor (`hasNativePlugin` is false), no service worker,
  and its own `localStorage`/IndexedDB (the app's settings and thumbnail cache at
  `https://localhost` aren't there; the host deletes this origin's storage on sign-out). Requests
  to hosts other than `api.github.com` (and `*.githubusercontent.com`) are refused and the page
  can't navigate away. Nobody touches it, so don't gate on visibility or user input. WebGL may not
  come up in a WebView that is never drawn: fall back to WASM quickly.
- **`window.FaceRunnerHost`** (synchronous; strings in and out):
  - `getAuth()` → `{ token, login, owner, repo, branch }` (`branch` "" = the default branch), or
    `"null"` when signed out.
  - `config()` → `{ budgetPerHour: 1500, deadlineMs, localThumbnails }`: thumbnail downloads per
    hour, the epoch ms by which the run must have committed (the host asks it to stop then), and
    whether `/_local/thumb/` can find anything on this phone.
  - `progress(JSON.stringify({ checked, total }))`: photos this run has checked, out of those it
    is working through; the notification shows "1,240 of 8,000 photos".
  - `finished(JSON.stringify({ checked, reason }))`: only **after the last commit**, the host
    destroys the page right away. `reason`: `"done"` (nothing left), `"deadline"`, `"stopped"`, or
    why the run was cut short (becomes `lastError`, at most 300 characters).
- **Stopping**: define `window.__404gbStopRunner()` before the first host call. The host calls it
  (deadline, app opened, unplugged, switched off); the page stops scanning, commits what it found
  and calls `finished` within 30 s, after which it is destroyed regardless. A page that hasn't
  called the host within 2 minutes of the run starting is closed as broken.
- **Local thumbnails**: `GET /_local/thumb/<mediaId>` → an 800 px WebP made on the phone from its
  own copy of that photo (backed up from it, found in the library already, or saved from it, and
  unchanged since), or 404. They cost no GitHub requests, so try them before the budget.

The web side:

- **Runner page** (`app/runner/faces/`, `lib/faces/runner.ts`): with a host it installs the stop
  hook, takes the session with `adoptHostSession` (memory only: nothing goes to `localStorage`,
  the plugin or the service worker's mirror, and a 401 just ends it there), points the library
  and faces stores at the repo (their caches are this origin's own; the daily Trash cleanup is
  left to the app) and runs `runBackgroundScan` (`lib/faces/scanner.ts`). Without a host it only
  says what it is for. `ServiceWorkerRegister` skips this page.
- **The background loop** is the app's scanner without the visibility, input and pause gating:
  thumbnails from `/_local/thumb/` first (when `localThumbnails`), then this origin's cache, then
  GitHub within `budgetPerHour` (burst `budgetPerHour / 20` a minute, at least 30). It waits and
  yields through a worker's timers and `MessageChannel` (`lib/faces/timers.ts`), as a page nobody
  looks at gets its timer chains throttled to one a minute. WebGL gets 30 s to load (and 45 s per
  photo) before the run goes on with WebAssembly; the model files aren't put in Cache Storage.
  `progress` goes out when the library is in, then every 5 photos (or 3 s); `checked` counts
  every photo the run settled, `total` is that plus what's left.
- **Ending**: it stops scanning 30 s before `deadlineMs` (halfway, for a run shorter than a
  minute), on the stop hook (the photo in hand gets 2 s), when nothing is left, when a used-up
  budget or GitHub's rate limit wouldn't free up before then, or when it can't go on (sign-in
  ended, another model's `faces.json`, a `faces.json` that isn't JSON, the library unreadable, no
  backend). Then everything pending goes into one commit (up to 24 s, tried up to 3 times); what
  doesn't land stays in this origin's IndexedDB for the next run, as do the detector results.
  `finished`'s reason is `"done"`, `"deadline"` (also for a used-up budget), `"stopped"`, or a
  sentence for Settings (e.g. "Your GitHub sign-in ended. Open 404GB to sign in again."); a
  planned end whose commit failed reports the failure instead.
- **In the app** (`lib/faces/background.ts`): the status is read when the scanner starts, when
  the app comes back to the foreground and every 2 s while a run is going. The app's scanner holds
  off up to 3 s for that answer, waits while `running` ("Finding people in the background while
  charging."), and after a run ends re-reads `faces.json` before it goes on. Settings › People has
  `BackgroundScanToggle`: "Find people while charging" with the last run (photos checked, why it
  stopped early) or "Running now"; it renders nothing in a browser or an app build without
  `setFaceScan`/`getFaceScanStatus`.

## `manifest/faces.json`

One JSON value per line, like `media-index.json` (`serializeJsonArray`): the header first, then
people sorted by id, then media sorted by id. The same content always gives the same bytes, so a
rename is a one-line diff.

```json
[
  {"version":1,"model":"face-api-1.7.15/tiny-512+224/landmarks-68-tiny/recognition-128/l2-int8x254"},
  {"person":"person_0pobnib1613fjp","name":"Bob"},
  {"person":"person_1arzhc21jw1j4g","into":"person_0pobnib1613fjp"},
  {"person":"person_1rxz1al0jd6khf","name":"Alice","hidden":true,"cover":"media_x#0"},
  {"media":"media_mv40lip3rw2hcsiw","faces":[{"box":[0.2,0.25,0.18,0.24],"score":0.97,"emb":"…172 chars…","person":"person_1rxz1al0jd6khf"}]},
  {"media":"media_mv40m1…","faces":[{"box":[…],"score":0.91,"emb":"…","person":"person_q…","not":["person_1rxz1al0jd6khf"]}]},
  {"media":"media_mv40m9…","faces":[]}
]
```

- **header**: `model` names everything the embeddings depend on. A file with another model is
  never extended by this version (no new scans; names, merges etc. still work) and the scanner
  says so in Settings.
- **media line** (one per scanned image; `"faces":[]` = checked, nobody there):
  `box` = `[x, y, width, height]` as ratios of the image (4 decimals; the same for every thumbnail
  size), `score` = detector confidence, `emb` = base64 of the 128-d descriptor **L2-normalized and
  quantized to int8** (`round(v × 254)`, clamped ±127; distance error < 0.01), `person` = who it
  is (possibly an alias, see `into`), `not` = people the user said it is *not*.
  Faces are ordered left to right; a face's key is `<mediaId>#<index>`.
- **person line** (only when there's something to remember): `name`, `hidden`, `cover` (a face
  key the user picked), `into` (merged into that person: their faces count as that person's; the
  line keeps its own name so a name is never lost).
- Size: ~260 bytes per face; e.g. 6,000 faces ≈ 1.6 MB.

## Writing: operations replayed in the race-safe transaction

The device keeps the last `faces.json` it read or wrote plus its own **pending operations**
(IndexedDB `404gb-faces`: `docs`, `pending`, and `scans` — every detector result per photo, so a
lost commit never means running the model again):

`scan` (a photo's faces) · `name` · `hide` · `merge` · `reject` ("not this person") · `cover`

The UI shows *file + pending operations*. A commit runs `lib/github`'s transaction: read
`faces.json` **at the head**, replay the pending operations on it, drop media lines of items no
longer in `media-index.json` (Trash emptied, deleted), write it back. If another device committed
meanwhile the ref update fails and the transaction starts again on the new head, so both
changes survive (e.g. two devices naming different people, or one naming while another scans).
Replaying is idempotent: a photo already in the file is skipped (its existing line wins), an
existing name/alias/correction is a no-op.

- Names, merges, hides, corrections and covers are committed ~1.2 s after the last change
  (`404gb: update people`).
- Scan results are batched: every **150 photos**, or 8 minutes after the oldest uncommitted one,
  or 3 s after the scan finishes, or when the app goes to the background with ≥ 25 photos (or 2+
  minutes old) pending (`404gb: faces in N photos`).
- Failures back off (30 s doubling to 15 min, or GitHub's `Retry-After`); a corrupt
  `faces.json` (not a JSON array) is never overwritten and Settings shows the error.
- Reading: a head check with ETag (a 304 is free) when the People UI mounts or the app becomes
  visible (≥ 60 s apart), then `faces.json`'s blob sha at that commit, and the file only when its
  sha changed.
- Signing out flushes pending operations (with the deletes) and deletes `404gb-faces` and the
  `404gb-faces:*` settings.

## Grouping (`lib/faces/cluster.ts`)

Deterministic, so the device's view and the commit agree, and two devices scanning the same
photos make the same people (ids are derived from the first face: `person_` + 64-bit FNV-1a).
Distances are Euclidean between unit vectors.

- **Assignment**: each new face joins the person whose centroid (normalized mean of their faces)
  is nearest, if within **0.34** — never a person who is already in the same photo. The faces of
  one photo pick in order of confidence. Otherwise it starts a new person.
- **Periodic merging**: after each photo, people who gained a face are merged with the nearest
  other person within **0.30**, unless both are named differently, one is hidden and the other
  isn't, they share a photo, or a "not this person" separates them. The named (else larger)
  person keeps their id.
- **User actions**: *rename* (empty = remove the name); *merge* (`into` alias; the target takes
  the other's name if it has none; earlier "not this person" between them is dropped); *not this
  person* (the face records `not`, leaves, and only moves to someone within 0.30 — else it
  stands alone; automatic merging never undoes it); *hide*; *profile photo* (cover).
- **Shown in People**: named people with at least one photo, unnamed people in **3+ photos**;
  hidden people only under "Show hidden people" (People screen, Settings › People). Trashed
  items don't count. Order: named first, then by number of photos. Avatar: the chosen cover, else
  the face with the best confidence × size.
- Cost (desktop, ~1,500 people): ~2.6 ms per photo to group, 0.2 s to load a 6,000-face file.

## UI

- `app/components/people/PeopleRow.tsx` (Albums): round avatars cropped from the face box
  (800 px thumbnail), names, "…" to the People screen; "Finding people… 1,240 of 8,000 photos"
  with a progress bar while nobody has been found yet; nothing when there's nothing to show.
- `/people` (`PeopleClient`): everyone, plus hidden people on demand (`?hidden=1`).
- `/people/view?id=` (`PersonClient`): the person's photos in the library grid (newest first,
  viewer, selection). Header: avatar, name / "Add a name", count; ⋮ Rename, "Same person as…"
  (face picker, most alike first), Hide/Show. Selection: **Not this person**, Use as profile
  photo, plus the usual actions. Naming someone with an existing name offers to merge. A merged
  id redirects to the person it was merged into.
- Settings › People (`PeopleSettings`): status and progress, Pause/Resume, Use mobile data,
  Find people while charging (Android app, `BackgroundScanToggle`), Re-scan, Hidden people, the
  privacy note and the backend in use.

## For other modules

`lib/faces/people.ts`: `usePeople(repoKey): { people, ready }` (cheap and reactive: recomputed
only when faces or the library change), `Person`, `FaceBox`, `personHref(id)`, plus
`useAllPeople`, `useFaceScanStatus` and the actions. `MediaLibraryView` takes `extraActions` for
screen-specific selection actions.

**Test seam**: if `window.__404GB_FACE_DETECTOR__` is a function when the engine starts, it is
used instead of the model (`({ mediaId, blob }) => Promise<{ box, score?, descriptor }[]>`);
the end-to-end tests inject a deterministic detector this way.

## Limits

- The tiny detector misses profile and very small faces; descriptors of children and look-alike
  relatives are close, so expect some merging/splitting to fix by hand.
- Face crops aren't rotated beyond what the landmarks give; strongly tilted faces group worse.
- `next build` prints a webpack "Critical dependency: require function" warning for face-api's
  bundled Node detection; it is never used in the browser.
- Every faces commit moves the branch, so other open clients re-read `media-index.json` on their
  next sync; batching keeps this to a few times an hour during a first scan.
