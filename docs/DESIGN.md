# 404GB design system — "Lumen"

Premium, calm, content-first. The photos are the hero; the chrome is quiet, glassy and
precise, like a first-party phone app. Blue by default; the user can pick another accent colour,
another font and the theme in Settings › Appearance. This replaces "Missing Tile" (no lime, no
mono uppercase labels, no dashed tiles, no wide display font).

Principles
- **Content first.** Photos edge to edge, chrome floats above them on glass, and nothing competes
  with the images.
- **Premium detail.** One typeface family used with care: tight large titles, tabular numbers and
  sentence case everywhere. Soft depth, generous spacing and real springs.
- **Alive, not busy.** Motion explains where things come from (a photo opens from its tile and
  goes back to it), and ambient colour comes from the photos themselves.
- **Fast on a mid-range Android WebView.** Blur only on fixed chrome, animate only transform and
  opacity, and never put per-tile shadows or filters in the grid.

## Tokens

All colours are RGB triplets in CSS variables (`rgb(var(--x) / <alpha-value>)` in Tailwind).
Keep the existing token NAMES so screens keep working: bg, surface, surface-2, surface-3, border,
border-strong, ink, ink-muted, ink-faint, accent, accent-strong, accent-ink, accent-inverse,
accent-2, signal, signal-ink, success, warning, danger, danger-ink. `signal`/`signal-ink` become
aliases of `accent`/`accent-ink`. Add:

- `--accent-text`: accent-coloured text and icons on bg/surface (AA 4.5:1).
- `--accent-soft`: a tinted fill. It is the accent at about 14% over surface, precomputed as a
  triplet.
- `--glow`: the aurora tint behind headers (the accent, used at 0.10–0.18 alpha).

| token | dark | light |
| --- | --- | --- |
| bg | 7 8 11 | 246 247 249 |
| surface | 16 18 23 | 255 255 255 |
| surface-2 | 24 27 34 | 240 242 245 |
| surface-3 | 33 37 46 | 231 234 239 |
| border | 37 41 51 | 225 228 234 |
| border-strong | 55 61 74 | 203 208 217 |
| ink | 244 246 250 | 13 15 20 |
| ink-muted | 160 167 182 | 82 89 104 |
| ink-faint | 122 129 145 (decoration only) | 132 139 153 (decoration only) |
| success | 52 211 153 | 4 120 87 |
| warning | 251 191 36 | 180 83 9 |
| danger | 255 99 117 | 214 40 57 |

"Pure black" option (dark only, for OLED): bg 0 0 0, surface 12 13 16, surface-2 20 22 27.

### Accent palettes (Settings › Appearance › Accent)

Here `fill` is `--accent`, the buttons, switches and selection. `text` is `--accent-text`, for
links and active icons on bg. `accent-ink` is white unless noted. Verify AA and adjust only the
lightness, never the hue:
- white on `fill` should reach at least 4.5:1;
- `text` on bg should reach at least 4.5:1.

| id | name | dark fill | dark text | light fill | light text |
| --- | --- | --- | --- | --- | --- |
| blue (default) | Sapphire | 41 111 246 | 120 172 255 | 22 96 235 | 18 84 214 |
| indigo | Indigo | 88 86 230 | 165 163 255 | 79 70 229 | 67 56 202 |
| violet | Violet | 139 76 230 | 198 164 255 | 124 58 237 | 109 40 217 |
| teal | Lagoon | 13 128 120 | 94 234 212 | 15 118 110 | 17 94 89 |
| green | Emerald | 4 128 90 | 110 231 183 | 4 120 87 | 6 95 70 |
| orange | Sunset | 214 72 10 | 253 166 102 | 194 65 12 | 154 52 18 |
| rose | Rose | 214 26 70 | 253 139 160 | 190 18 60 | 159 18 57 |
| graphite | Graphite | 228 230 236 (accent-ink 13 15 20) | 228 230 236 | 30 33 40 | 30 33 40 |

`accent-2` is a fixed secondary for people and faces: dark 167 139 250, light 109 40 217. For
the violet accent use teal (45 212 191 / 15 118 110) instead.

Implementation: `html[data-accent="<id>"]` sets the accent variables for both themes. Without
the attribute it is blue. The choice is stored in localStorage `404gb-accent` and applied by
the same inline head script as the theme, so there is no flash. The theme-color meta and
SystemBarsSync follow bg.

## Typography (Settings › Appearance › Font)

One family for everything. Large titles use the same family, heavier and tighter.
- `--font-sans` is the chosen family.
- `--font-display` is an alias of `--font-sans`.
- `--font-mono` is only for code-like values such as the device code and commit sha. Use Geist
  Mono, or ui-monospace when it isn't loaded.

Font choices are OFL variable woff2 files in app/fonts/ with their licences, loaded with
next/font/local. A font file is only downloaded when it is used.

| id | name | notes |
| --- | --- | --- |
| geist (default) | Geist | crisp, modern, premium-standard |
| inter | Inter | classic, SF-like (use Inter's display optical size for titles if available) |
| jakarta | Plus Jakarta Sans | warm, rounded |
| manrope | Manrope | geometric, airy |
| system | Device font | system-ui / Roboto (no download) |

`html[data-font="<id>"]` switches `--font-sans`. It is stored in localStorage `404gb-font` and
applied by the head script.

| role | size/line | weight | tracking |
| --- | --- | --- | --- |
| large-title | 32/38 (34/40 desktop) | 700 | -0.025em |
| title | 22/28 | 650 | -0.015em |
| headline | 17/22 | 600 | -0.01em |
| body | 15/22 | 400 | 0 |
| callout | 14/20 | 500 | 0 |
| footnote | 13/18 | 450 | 0 |
| caption | 12/16 | 550 | 0.01em |

Rules:
- Sentence case everywhere: no uppercase labels and no letter-spaced mono "telemetry".
- Counts and sizes use `tabular-nums` in the sans font.
- Section headings in lists are 13px/600 in ink-muted, sentence case.

## Shape, space, elevation

- **Radii:** photo tiles 4px (grid gaps 2px phone, 3px desktop); controls 14px; cards 22px;
  sheets 28px top corners; hero cards 26px; chips and buttons full pill; avatars round.
- **Spacing:** a 4px base. Screen gutters are 16px on phone and 32px on desktop. Cards have 16–20px
  padding.
- **Depth, dark theme:** a 1px top inner highlight (white at 6%) on cards plus a very subtle
  vertical gradient (surface to surface at 92%). No drop shadows.
- **Depth, light theme:** two-layer soft shadows (0 1px 2px at 6%, 0 8px 24px at 6%).
- **Glass (fixed chrome only: nav, compact headers, viewer bars, sheets' grabber area):**
  `backdrop-filter: blur(24px) saturate(160%)` over bg at 72% (dark) or 78% (light), with a 1px
  hairline border (white 8% / black 6%).
- **Aurora:** a large radial gradient of `--glow` at 0.12 alpha behind the top of Photos,
  Settings and sign-in. It is static: no animation, no blur filter.

## Motion

- Springs: standard `cubic-bezier(0.32, 0.72, 0, 1)` at 380ms (iOS-like sheet curve); quick
  ease-out at 160ms for presses.
- Press feedback: scale 0.97 plus a slight dim on every tappable card and tile.
- Haptics: `lib/ui/haptics.ts` with `tick()` (8ms), `select()` (12ms) and `confirm()`
  ([10, 40, 18]). It uses `navigator.vibrate` when available and is a no-op otherwise or with
  reduced motion. Haptics are for long-press selection, drag-select steps, pull to close, toggles
  and successful actions.
- Reduced motion: fades only, at 120ms. No Ken Burns, no shared-element zoom (crossfade instead).

## Components (foundation)

- **NavBar (phone):** a floating glass capsule 64px tall, 12px above the safe area, with 4 tabs
  (icon plus 11px label). The active tab gets an `accent-soft` pill behind its icon that slides
  between tabs with the spring, and the active icon and label use accent-text. It hides on fast
  downward scroll in Photos and comes back on upward scroll (transform only).
- **NavBar (desktop, ≥1024px):** a left sidebar 248px wide on surface: the brand mark and
  wordmark, then the tabs as rows with an accent-soft active pill and icon, then the repo chip at
  the bottom.
- **PageHeader:** a large title (large-title role) with an optional subtitle line (footnote,
  ink-muted: "1,443 photos · 17.8 GB") and action buttons (round 40px glass icon buttons). After
  24px of scroll it collapses into a compact glass bar with a centred 17px/600 title. Keep the
  API, including `useScrolledPast`.
- **Buttons:**
  - primary: accent fill, accent-ink, 48px, pill, 15px/600;
  - secondary: accent-soft fill with accent-text;
  - tertiary: surface-2 with ink;
  - ghost;
  - destructive: danger fill.
  - All have 44px minimum targets and a visible focus ring in accent.
- **Switch:** iOS-style track 51×31 with a white knob, accent when on, spring knob.
- **SegmentedControl:** a surface-2 track with a sliding raised thumb (surface plus soft shadow,
  or surface-3 in dark).
- **Chip:** a pill 34px tall with an optional icon or avatar and a count. Selected uses accent fill
  and accent-ink. Removable search chips.
- **Progress:** a thin rounded bar (6px, accent on surface-3) and a ring variant (for People and
  backup). This replaces TileMeter (keep the export name as a thin wrapper if screens use it).
- **StatusBadge / BackupStatusPill:** a small pill with a dot or tiny ring and sentence-case
  text: "Backed up", "128 to go", "Waiting for Wi-Fi", "Paused · battery low", "Sign in", "Allow
  access", "Offline". The accessible text is unchanged.
- **Cards / SettingsBlocks:** grouped inset lists like iOS Settings. Rows are 52px with a
  rounded-square 30px coloured icon badge, title, value and chevron, plus hairline separators
  inset from the icon. Bento tiles become cards with an icon badge, a title and a value.
- **Sheet:** a bottom sheet with a 28px radius, grabber, glass header, drag to dismiss and
  backdrop 50% black.
- **Toast:** a glass pill at the bottom above the nav, with an icon and an optional accent action.
- **ConfirmDialog:** centred card 22px radius, title 17/600, primary and secondary buttons.
- **EmptyState:** a soft illustration (stacked rounded photo cards with an accent glow, made in
  SVG), a title and a one-line hint.
- **SelectCheck:** a round 24px check: white ring when not selected, accent fill with a white
  tick when selected, and a pop animation.
- **Skeleton:** surface-2 blocks with a slow shimmer.
- **BrandMark:** a rounded-square app icon with a deep blue gradient (from 22 96 235 to 10 40 120)
  and a white glyph of two overlapping rounded photo frames. Regenerate the web and Android icons
  and splash screens.

## Screens

- **Photos:** see "Photos — new experiences" below.
- **Viewer:** see below.
- **Albums:**
  - the large title "Albums";
  - a People rail with round 64px avatars and names, plus "See all";
  - smart categories as a 2-column grid of photo-cover cards (cover image, gradient scrim, title
    and count in white);
  - "Your albums" as a cover grid;
  - Trash and Duplicates as list rows at the end.
- **People:** a grid of round avatars (3 columns on phone) with names and counts, and a scan
  progress card at the top while scanning. The person page has a large avatar header, the name
  (tap to rename), the count, and the grid.
- **Settings:** grouped inset lists:
  1. **account / repo card** at the top: the avatar, `@login`, owner/repo, repo size and the last
     backup, with Change and Open on GitHub actions;
  2. **Backup:** status with progress, the on/off switch, Wi-Fi only / mobile data (segmented),
     charging only, and stats;
  3. **People:** progress ring, "Find people in the background", "Only while charging",
     re-scan and pause;
  4. **Appearance:** theme (System/Light/Dark segmented), Pure black switch, Accent (a row of 8
     round colour swatches with a check on the active one, live preview), Font (cards showing
     "Aa" and the font name in that font, live preview);
  5. **Library:** duplicates, Trash, install app;
  6. **About and sign out.**
- **Sign-in:**
  - a full-screen aurora with a large brand mark;
  - "Your photos. Your GitHub." as the title, with a one-line subtitle;
  - a primary "Sign in with GitHub" button;
  - the device code in a large monospace card with copy;
  - "Use a token instead" as a link.
- **Repo picker:** a search field and a list of repo rows with lock icons and a "Create new
  library" card.
- **Upload:** a large rounded dashed drop area with an icon and helper text, and queue rows with
  thin progress bars.

## Photos — new experiences (the signature screen)

1. **Spotlight hero:** a swipeable carousel at the top of the Photos timeline.
   - **Cards:** full-bleed, 26px radius, about 0.8 aspect on phone and 21:9 on desktop.
   - **Content:** the memories ("On this day · 3 years ago", "This week", "Recent highlights",
     "With <person>"). Each card shows a cover photo with a slow Ken Burns drift (a transform
     only, on the visible card only, 12s), a bottom gradient scrim, the title (title role, white),
     a subtitle and a small play glyph.
   - **Navigation:** page dots below the cards.
   - The hero scrolls away with the timeline. When there are no memories it's a single "Recent"
     card, and it's hidden when the library is empty.
2. **Story player:** tapping a spotlight card opens a full-screen story of its photos.
   - **Playback:** 5s per photo (a video plays through, muted by default with an unmute
     button), with segmented progress bars at the top.
   - **Controls:** tap the right or left third to go forward or back, press and hold to pause,
     swipe down to close back into the card (shared-element shrink), and swipe up or tap "Open"
     to jump to that photo in the viewer.
   - **Effects:** each photo crossfades in with a gentle zoom, and the title and date sit at the
     top left. Prefetch the next two images.
3. **Quick collections rail:** under the hero (and pinned under the compact header while
   searching), a horizontal row of pills:
   - Favorites, Videos, Screenshots, Selfies (if categorised), Recently added;
   - a People pill with a 3-avatar stack and, while scanning, a tiny progress ring.

   Tapping one filters the timeline inline, using the existing filter state, and the selected
   pill uses the accent fill.
4. **Timeline headers that tell a story:**
   - **Day headers:** "Today", "Yesterday", or "Sat, 11 Oct" (year added when it isn't this
     year), plus a footnote such as "24 photos · 3 videos". When face data is known, add a 2–3
     avatar stack of the people in that day's photos.
   - **Month headers** in Month view are large (title role) with the year in ink-muted.
   - **Select:** a round check at the end of the header selects that day.
5. **Drag to select:** a long press on a tile selects it (with a select haptic), and dragging
   then selects or deselects the range under the finger, as in Google Photos.
   - It auto-scrolls near the top and bottom edges, gives a tick haptic per change, and selected
     tiles shrink to 0.9 with an accent ring and check.
   - Desktop: shift-click selects a range.
6. **Shared-element open:**
   - Tapping a tile opens the viewer with the photo zooming from the tile's rectangle to full
     screen (FLIP: transform plus opacity on a single overlay image), while the backdrop fades
     to black.
   - Closing (the back button or swipe down) shrinks the photo back into its tile, scrolling the
     grid if needed so the tile is on screen.
   - Swipe-down to dismiss follows the finger with scale and backdrop fade.
   - Reduced motion: a crossfade instead of the zoom.
7. **Pinch to zoom the grid** (it exists): animate the column change smoothly (scale the grid
   from the pinch focal point, then settle) instead of jumping.
8. **Fast scrubber:** a thin handle on the right edge appears while scrolling. Dragging it shows a
   glass date pill ("Oct 2026") and gives a tick haptic per month.
9. **Glass header:** the large "Photos" title, the subtitle "1,443 items · 17.8 GB", the backup
   status pill, and round glass buttons for search and select. The search opens a full-width
   glass search field with suggestion groups (people avatars, places/categories, dates,
   recent searches).

Performance budget:
- 60fps scrolling with 10k items, and no layout thrash.
- Ken Burns and story animations use the compositor only.
- The grid tiles have no box-shadow, no filters and no blur.
- Hero images use the 800px thumbnails, and the grid keeps its current thumbnail sizes.

## Viewer

- **Ambient background:** behind the photo, the same photo's thumbnail scaled to cover, blurred
  (a CSS filter on that one fixed element, rendered once at small size and scaled up), darkened
  to 55%. It is the only blur outside the chrome. Turn it off with reduced motion only if it
  costs frames.
- **Glass chrome:**
  - top bar: back, the date and time (headline plus footnote), and an overflow menu;
  - bottom bar: share, favourite (heart that pops), edit, info, delete.
  - Tapping the photo toggles the chrome with a fade.
- **Original badge:** a small glass pill that says "Original" with a check once loaded, or
  "Loading original 42%" while loading.
- **Info sheet:** the date, the file, size and dimensions, the people in this photo (avatars,
  tap to open the person), the album/category, and the commit/GitHub link.
- **Swipe:** left/right moves between photos (it exists); swipe down closes (shared-element).

## Implementation notes

- Keep component APIs and every accessible name the e2e tests use. List intentional visible
  string changes in your report.
- Settings › Appearance writes `404gb-theme`, `404gb-accent`, `404gb-font` and `404gb-black`. The
  head script in app/layout.tsx applies all of them before first paint. Bump the service worker
  version when public assets change.
- Fonts are OFL only and live in app/fonts with their licences. Get them from npm packages (`npm
  pack geist`, `@fontsource-variable/inter`, `@fontsource-variable/plus-jakarta-sans`,
  `@fontsource-variable/manrope`) using a scratch folder; never add them as app dependencies just
  for the files.
