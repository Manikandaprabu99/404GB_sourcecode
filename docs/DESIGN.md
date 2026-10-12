# 404GB design system — "Missing Tile"

404GB stores your photos in a Git repo, and its logo is a 2×2 grid with one dashed, missing
tile. The interface is built from that idea: **tiles, telemetry and one bright signal colour**.
It should never read as stock Material, iOS, Google Photos or shadcn. Photos stay the hero:
chrome is quiet ink, type does the talking, and lime marks what is live.

Signature elements (use them consistently; they are what makes the app recognisable):

1. **Tiles, not circles.** Rounded squares everywhere a stock app would use a circle or a pill:
   the active-tab indicator, the switch knob, selection checks, progress meters, the scrubber
   handle and status badges.
2. **The missing tile.** A dashed outline that *fills in*: the nav indicator fills when a tab
   becomes active, empty states show the 2×2 mark with its dashed tile breathing, skeletons and
   drop zones use dashed tiles, and progress is a row of tiles filling with lime.
3. **Telemetry labels.** Small uppercase monospace lines carry facts like a dev console:
   `SUN 12 OCT · 14`, `12,431 ITEMS · 38.2 GB`, `128 TO GO`, `LAST COMMIT 3F9C2E1`.
4. **Wide display type.** Big titles, years and numbers in Unbounded: `Photos`, `2024`,
   `18.4 GB`, `3 years ago`.
5. **Signal lime.** One saturated accent (#C8F542) on ink or paper, used for fills (badges,
   primary buttons, switch tracks, nav tile, progress, selection), never as body text on light.

## Tokens

All colours are RGB triplets in `app/globals.css` (used as `rgb(var(--x) / <alpha>)` by
Tailwind), keeping the existing names. New tokens: `--signal`, `--signal-ink`, `--accent-2`.

| Token | Dark ("Ink") | Light ("Paper") | Use |
| --- | --- | --- | --- |
| `--bg` | 10 10 11 `#0A0A0B` | 243 242 237 `#F3F2ED` | app background |
| `--surface` | 18 18 20 `#121214` | 255 255 255 `#FFFFFF` | cards, sheets, nav |
| `--surface-2` | 26 26 29 `#1A1A1D` | 234 233 227 `#EAE9E3` | inputs, inactive chips, tiles |
| `--surface-3` | 35 35 39 `#232327` | 224 223 216 `#E0DFD8` | pressed, raised in dark |
| `--border` | 42 42 47 `#2A2A2F` | 220 219 211 `#DCDBD3` | hairlines |
| `--border-strong` | 61 61 68 `#3D3D44` | 198 197 188 `#C6C5BC` | focus-adjacent, dividers |
| `--ink` | 242 242 238 `#F2F2EE` | 17 17 19 `#111113` | primary text |
| `--ink-muted` | 161 161 168 `#A1A1A8` | 85 85 92 `#55555C` | secondary text |
| `--ink-faint` | 109 109 117 `#6D6D75` | 133 133 140 `#85858C` | telemetry, placeholders |
| `--signal` | 200 245 66 `#C8F542` | 200 245 66 `#C8F542` | **fills**: badges, primary buttons, switch on, nav tile, progress, checks |
| `--signal-ink` | 14 20 0 `#0E1400` | 14 20 0 `#0E1400` | text/icons on signal |
| `--accent` | 200 245 66 `#C8F542` | 74 112 0 `#4A7000` | accent **text/icons** (links, active labels) |
| `--accent-strong` | 172 222 38 | 55 85 0 | hover/pressed accent |
| `--accent-ink` | 14 20 0 | 255 255 255 | text on `bg-accent` |
| `--accent-inverse` | 74 112 0 | 200 245 66 | accent on the opposite theme's surface |
| `--accent-2` | 139 124 255 `#8B7CFF` | 91 75 234 `#5B4BEA` | secondary highlight (People, faces, brand mark) — sparingly |
| `--success` | 74 222 128 | 21 128 61 | |
| `--warning` | 255 181 71 | 161 92 0 | |
| `--danger` | 255 90 110 | 217 45 68 | |
| `--danger-ink` | 30 6 10 | 255 255 255 | |

Focus ring: 2px `signal` (dark) / 2px `accent` (light) with 2px offset in `bg`. Selection
highlight on tiles: `signal`. Contrast: body text ≥ 4.5:1 in both themes; never lime text on
light backgrounds (use `accent`, which is moss there).

## Typography

Self-hosted variable woff2 (OFL) in `app/fonts/` with their licence files (≈ 87 KB total,
replacing Inter + JetBrains Mono): **Unbounded** (`--font-display`, wght 200–900, 50.9 KB),
**Host Grotesk** (`--font-sans`, wght 300–800, 20.3 KB), **Kode Mono** (`--font-mono`,
wght 400–700, 15.8 KB). Sources and licences: the 404GB scratchpad copy of the tile study
(`design/tile/fonts/`) or Google Fonts.

| Role (Tailwind `fontSize` key) | Font | Size / line | Weight | Tracking | Where |
| --- | --- | --- | --- | --- | --- |
| `display` | display | 40 / 1.05 | 700 | −0.03em | year headers, sign-in wordmark, hero numbers |
| `h1` | display | 30 / 1.1 | 700 | −0.02em | page titles (Photos, Albums, Settings…) |
| `h2` | display | 20 / 1.2 | 600 | −0.01em | section titles (On this day, Categories), month headers 22px, sheet titles |
| `h3` | sans | 17 / 1.3 | 600 | −0.005em | day headers, card titles |
| `body-lg` | sans | 16 / 1.5 | 400 | | |
| `body` | sans | 15 / 1.5 | 400 | | default |
| `small` | sans | 13 / 1.45 | 400 | | descriptions |
| `micro` | sans | 11 / 1.3 | 500 | 0.02em | nav labels |
| `label` (new) | mono | 11 / 1.2 | 500 | 0.08em, UPPERCASE | telemetry, section labels, badges |

Numbers in telemetry are tabular (`tabular-nums`). Big numbers: display font with the unit in
`h2` size, `ink-muted` (e.g. **18.4** GB).

## Shape, space, elevation

- Radii: tiles in the photo grid **3px**; tile controls 8–10px (`rounded-tile` = 10px); cards
  **20px**; sheets 28px (top); dialogs 24px; inputs 14px; chips full pill; avatars round (faces
  are the one place circles stay).
- Spacing: 4px grid; screen gutter 16px (phone) / 24px (≥ sm); card padding 16–20px; grid gap
  2px (phone), 3px (sm), 4px (≥ lg).
- Elevation: dark mode separates by surface steps plus 1px `border/60`; light mode uses white
  cards with `shadow-soft`. Glass blur (backdrop-filter ≤ 20px) **only** on the floating nav,
  the collapsed page header, sheets and toasts — never per tile or in scrolling lists.
- Optional ambient glow: one very faint radial lime/iris glow behind the top of a page header
  (≤ 10% opacity, fixed, decorative) — skip it if it costs scrolling smoothness.

## Motion

Easing: `ease-out-expo` (0.16, 1, 0.3, 1) for most moves; `ease-spring` for the nav tile and
switch knob. Durations: 120 (press), 180 (chips, small fades), 250 (sheets, toasts, page fade),
320–360 (nav tile slide + fill, grid zoom). Animate only transform and opacity.

- Nav tile: slides to the new tab (translateX, 340ms spring), then the dashed outline fills
  with lime (scale/opacity of the fill layer, 160ms). Icons press-scale 0.94.
- Page enter: fade + 8px rise, 240ms. Grid first paint: rows fade in with a short stagger (first
  viewport only). Zoom (Day/Month/Year) keeps the existing anchored scale animation.
- Selection: tile shrinks to 0.88 with 12px radius; the square check pops (scale 0.6 → 1).
- Progress tiles fill left to right; the tile being filled pulses gently.
- Empty-state missing tile breathes (opacity 0.4 ↔ 1, 2.4s).
- `prefers-reduced-motion`: no slides, scales or pulses; 120ms opacity fades only.

## Components

- **Bottom nav (phone):** floating bar, 12px from the sides and `12px + safe-area` from the
  bottom, 64px tall, radius 22, `surface/80` + blur 16 + saturate 1.3, 1px `border/70`,
  `shadow-elevated`. Four equal items (Photos, Albums, Upload, Settings): 22px icon + `micro`
  label. Active: the lime tile (44×30, radius 10) behind the icon, icon in `signal-ink`, label
  in `ink`; inactive icons `ink-muted`, labels `ink-faint`. Content scrolls under it (bottom
  padding accounts for it). **Desktop top bar:** 56px, the brand mark + wordmark "404GB"
  (display, 16px), text tabs with a sliding 4px lime tile underline, repo as a mono chip.
- **Page header:** large title (`h1`) with an optional telemetry line and right-side actions
  (40px icon buttons, `surface-2`, radius 12). After ~24px of scroll it collapses into a compact
  bar: title 17px sans 600, `bg/80` + blur, hairline bottom border; the large title fades/
  translates out.
- **Status badge** (backup, scan state): 24px tall, radius 8, `label` text. Live/OK →
  `bg-signal text-signal-ink` (`128 TO GO`, `UP TO DATE`); neutral → `surface-3` +
  `ink-muted` (`WAITING · WI-FI`, `PAUSED · BATTERY`); attention → `warning/15` + `warning`
  (`SIGN IN`, `ALLOW ACCESS`). While uploading, a 4-tile glyph before the text fills in turn.
- **Tile meter** (progress): N small tiles (16×8, radius 3, gap 3) — filled `signal`, empty
  `surface-3`, current one pulsing; label above/right in `label` text (`1,240 / 8,000`).
- **Chips** (filters): 34px, full pill, padding 14. Inactive `surface-2` + `ink-muted`;
  active inverted (`bg-ink text-bg`); press 0.96. Search-term chips: `surface-3` + `ink` with ×.
- **Search field:** 46px, radius 14, `surface-2`, search icon, placeholder "Search people,
  dates, screenshots…"; focus ring lime. Suggestion panel: `surface`, radius 20, group labels
  in `label` text (`PEOPLE`, `CATEGORIES`, `DATES`, `ALBUMS`), round 32px avatars.
- **Buttons:** primary `bg-signal text-signal-ink`, radius 14, 48px (phone) / 40px (desktop),
  sans 600; secondary `surface-2` + `ink`; ghost transparent + `ink-muted` hover `surface-2`;
  danger `danger/12` + `danger`. Press 0.97.
- **Switch (tile switch):** track 46×28 radius 9; knob 22×22 **rounded square** radius 7.
  Off: track `surface-3`, knob `ink-faint`. On: track `signal`, knob `signal-ink`. 200ms spring.
- **Segmented control:** `surface-2` container radius 14, padding 4; active segment `surface`
  (light) / `surface-3` (dark) with `ink` text, sliding; inactive `ink-muted`.
- **Cards:** `surface`, radius 20, 1px `border/60` (dark) or `shadow-soft` (light), padding
  16–20. **Bento tiles** (Settings library section, Albums categories): 2-column grid of square-
  ish cards with a 36px icon tile (radius 10, tinted 14% background), title, mono value.
- **List rows:** min 56px, 36px icon tile, title 15/500, description `small` `ink-muted`,
  trailing value in mono or a chevron.
- **Sheet:** top radius 28, `surface`, 36×4 grabber, title `h2`. **Dialog:** radius 24.
  **Toast:** floats above the nav, `surface-3`, radius 16, action in `accent`.
- **Empty states:** the 2×2 mark at 28px tiles (three `surface-3`, one dashed `signal`,
  breathing), title `h2`, body `small` `ink-muted`, one primary action.
- **Skeletons:** `surface-2` tiles with a slow shimmer; drop zones and placeholders use a dashed
  `border-strong` tile outline.
- **Selection bar:** floating, radius 20, `surface-3` (dark) / `ink` (light, inverted), count as
  `label` (`3 SELECTED`), icon actions.

## Screens

- **Photos.** Header: `Photos` (`h1`) + telemetry `12,431 ITEMS · 38.2 GB` (or `BACKING UP`
  facts) in `label` `ink-faint`; right: status badge, view (Day/Month/Year) and Select icon
  buttons. Below: search field, then filter chips. Collapses as above. Memories: section
  `On this day` (`h2` 18px) + `3 MEMORIES` label; cards 148×208, radius 18, bottom gradient,
  `3 years ago` (display 16px) + `13 OCT 2023` label. Date headers: **Day** — left `h3`
  ("Today", "Saturday, 11 October"), right label `SUN 12 OCT · 14` (`ink-faint`, count last);
  **Month** — `October` display 22px + label `2026 · 312`; **Year** — `2024` (`display`) +
  label `1,204 ITEMS`. Tiles: radius 3, gaps above; video badge `label`-style duration on
  `black/55`; favourite heart; selection per Motion. Scrubber: rounded-square handle 30×40
  (radius 10, `surface-3`, two chevrons), lime bubble with `OCT 2024` in mono, year markers in
  mono. Empty state: missing tile.
- **Settings.** `Settings` (`h1`) + label `@LOGIN · OWNER/REPO`.
  1. **Repo card** (hero): label `REPO · OWNER/REPO`; size in display 44 with the unit smaller
     (repo size from `GET /repos/{owner}/{repo}` → `size` in KB, cached ~1 h; fall back to the
     library's byte total); label line `2,481 PHOTOS · 112 VIDEOS · LAST COMMIT 3F9C2E1` (head
     sha the library already knows); actions Change / Open on GitHub as ghost buttons.
  2. **Backup card**: title + tile switch; status badge + headline sentence; tile meter for the
     current run / backlog; stats as a 2×2 mono grid (`BACKED UP`, `WAITING`, `ALREADY IN
     LIBRARY`, `FAILED`); Wi-Fi/mobile data segmented; charging switch; folders segmented;
     battery-optimisation callout.
  3. **People card**: avatar stack of the top people, `Finding people` + tile meter
     `1,240 / 8,000`, pause/resume, background-while-charging switch (when the app supports
     it), privacy note.
  4. **Library bento** (2 columns): Duplicates, Trash (counts), Theme (Dark / Light / System
     segmented with tiny tile previews), Install (browser only).
  5. **Account row**: avatar, `@login`, Sign out (danger ghost).
  6. Footer label: `404GB · YOUR PHONE IS FULL. YOUR REPO ISN'T.`
  Section labels between groups use `label` text (`BACKUP`, `PEOPLE`, `LIBRARY`, `ACCOUNT`).
- **Albums.** `Albums` (`h1`). People row: 64px round avatars with names, `accent-2` ring on
  focus. `Categories` (`h2`): bento grid, cover photo full-bleed radius 18, bottom gradient,
  name 15/600 + mono count; the largest category may span 2 columns. `Your albums` same cards;
  Trash row with count.
- **People / person.** Person header: 96px round avatar, name in display 24, label count;
  grid as Photos.
- **Sign-in.** Brand hero: the mark at 96px with the missing tile filling in on load, `404GB`
  in `display`, tagline; the device code in mono 28px with **each character in its own tile**;
  primary button.
- **Repo picker.** List rows with repo names in mono; new-repo field.
- **Upload.** Drop zone as a big dashed tile; queue rows with mono progress and tile meters.
- **Viewer / editor chrome.** Keep the dark gradient bars; round 44px icon buttons; the
  Original chip becomes a `label` badge (`ORIGINAL ✓` in signal when shown, neutral while
  loading with a percentage).
- **Desktop.** Same tokens; top bar; Photos header stays expanded until scrolled; Settings in a
  centred column (max 720px) with the bento as 3 columns.
- **App icon / brand mark.** Ink background `#0A0A0B`, three lime tiles (`#C8F542`) and the
  dashed lime missing tile; regenerate web icons (favicon, 192/512, apple-touch) and the
  Android launcher/splash assets from the new mark.

## Implementation notes

- Keep every user-facing string and accessible name used by the end-to-end tests unless a
  change is intentional; list intentional changes.
- Foundation first (fonts, tokens, Tailwind keys, shared components, nav, header, badges,
  meters, empty states, sign-in); screens build on it without redefining primitives.
- Respect safe areas, `prefers-reduced-motion`, 44px touch targets, both themes and desktop.
