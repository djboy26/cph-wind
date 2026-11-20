# Sprint 2: smooth and fast

Opened 2026-11-20 from DJ's brief: "pick up, clean up, smoothen it up … peak performance and
visuals". Branch `sprint-2`, cut from `sprint-1` (PR #1, not merged yet), so its pull request
targets `sprint-1` and shows only this sprint's work. DJ merges; nothing here pushes to `main`.

| item | what | kind (D3) |
|---|---|---|
| 1 | Basemap: OpenFreeMap's Positron (D5) | pull request with preview; needs eyes |
| 2 | Performance: no per-frame rebuilds, buildings off the main thread, measured | pull request with preview |
| 3 | Visual polish from the laptop screenshots | pull request with preview; needs eyes |
| 4 | Clean-up: merged branches and stray files | unattended, on the laptop |

Carried over: Sprint 1 item 4 (the R2 cutover) still waits on DJ's R2 account and `.r2.local`.

## 1. Basemap: OpenFreeMap's Positron

`MAP_STYLE` in `src/App.tsx` moves from CARTO to `https://tiles.openfreemap.org/styles/positron`.
The credit (`Attribution.tsx`, `About.tsx`) and the harness's basemap check (`shots.mjs`,
`BASEMAP_HOST`) follow. Reasons and terms: `docs/decisions.md` D5.

Needs eyes: the map's colours against the arrows at the city view and at zoom 17.5, and the
credit line on a phone.

## 2. Performance

Measured on the real Copenhagen data first (container, Node 24; per frame, 16.7 ms is the
whole budget at 60 fps):

| work redone | cost | when |
|---|---|---|
| the arrow field (`buildFlowField`) | 5 to 50 ms (zoom 16.5 to 13.5) | every pan frame: it depended on the view's latitude |
| filter of 221,812 buildings | 23 ms, plus re-extruding the box | every zoom frame on desktop |
| bike-lane filter of 37,799 roads | 1.2 ms, plus 9,791 paths re-uploaded | every zoom frame |
| road band pieces | up to 13 ms | every zoom frame from 16 |
| parse of the 42 MB buildings file | 0.9 to 1.2 s, one freeze | first zoom past 14 |
| one rebuild per segment tile landing | ~28 rebuilds as a city view loads | first paint |

Changes:

- `buildFlowField` splits into `buildLattice` (streets and pitch only) and `colourLattice` (the
  wind). Same output to the byte on the real data at five views and three winds; 1.5 to 2.6×
  faster; the time slider only recolours (2 ms instead of 50 at the city view).
- The pitch is taken at the middle of the snapped box, so the field rebuilds when the box
  changes, not every frame. The snap cell grows with the view (about a quarter screen).
- Road band, bike lanes and buildings depend on "zoom past the threshold", not on the zoom.
  Bike lanes are built once and shown or hidden.
- Buildings: parsed in a worker (`src/buildings/`), served in 0.02° chunks, one layer per
  chunk, so a pan extrudes only the chunks that come into view.
- Segment tiles that land within 80 ms of each other enter the cache in one update.
- The always-mounted panels (`TopBar`, `Legend`, `TimeSlider`, `Attribution`, …) are memoised,
  so a pan frame no longer re-renders them.
- `npm run perf` (`scripts/perf.mjs`): five gestures in headless Chromium, with the main
  thread's script time, long tasks and frame intervals. Numbers below.

### Measured in a browser: `npm run perf`

DJ's laptop, Chromium with the RTX 4050 (ANGLE, Direct3D 11), the wind mocked, 2026-11-20.
Before is item 1 alone (56ba106); after is the sprint at aee4791, and at 1d25288 for the
zoom row (chunks one per frame, shaders compiled while idle). Each gesture sends the same
input to both. A long task is 50 ms or more in which the page cannot answer a finger or a
mouse; a frame interval over 33 ms is a dropped frame at 60 fps.

| gesture | long tasks, total | worst task | frame p95 | frame max |
|---|---|---|---|---|
| pan, desktop city view (zoom 13.5, pitch 40) | 182, 16.8 s → 9, 0.6 s | 158 → 80 ms | 97.2 → 7.1 ms | 160 → 90 ms |
| zoom 13.5 → 17.5, first 3D buildings | 36, 3.8 s → 7, 0.8 s | 721 → 426 ms | 76.5 → 27.8 ms | 778 → 660 ms |
| pan at zoom 16.5, buildings up | 0 → 0 | none → none | 13.9 → 7.3 ms | 55.5 → 55.8 ms |
| twelve steps along the forecast | 12, 0.85 s → 0 | 74 ms → none | 62.5 → 7.1 ms | 76.5 → 20.7 ms |
| pan, phone city view, CPU 4× slower | 177, 37.3 s → 9, 0.9 s | 292 → 146 ms | 243 → 35.2 ms | 313 → 188 ms |

Script time is not in the table: the gestures last longer when the page is slower, and the
arrow wave keeps drawing at 60 frames a second the whole time, so it mixes the two.

The first pair of runs was taken while the laptop was loaded (a test run alongside timed
out five tests) and is not in the table; it pointed the same way with larger numbers
(city pan: 208 long tasks, 41 s, before). The table is a second pair, run back to back.

Where the time goes now (CPU profile of two city-view drags at aee4791): 44 % idle,
MapLibre 26 %, the app and deck.gl 15 %, of which `buildLattice` 4 % (the box changing
every quarter screen). The basemap is now the larger cost of a pan.

The first zoom past 14 still has one long task of about 0.4 s (426 and 425 ms in two runs).
Parsing in the worker cut the zoom's long tasks from 3.8 s to 0.8 to 1.1 s at aee4791, but
not its worst task (561 and 732 ms): a whole view's chunks were extruded at once, on top of
the first compile of the building shaders. Pacing the chunks and compiling while idle took it
to 0.4 s. What is left is the first chunks' extrusion and MapLibre preparing its street-level
layers; it is the next thing to profile.

### Completed 2026-11-20 — commits dbea779, ea6cf56, f8dc015, aee4791, 1d25288

205 tests in 21 files (191 in 19 before the sprint). Harness `docs/renders/s2/report.md`:

| view (wind sw4) | arrows built | drawn by the GPU | segment tiles | sprint 1 (built, drawn, tiles) |
|---|---|---|---|---|
| city, desktop (pitch 40) | 5,069 | 2,592 | 32 | 5,177, 2,591, 28 |
| city, phone | 981 | 451 | 12 | 1,169, 451, 16 |
| zoom 16.5 | 2,341 | 553 | 4 | 2,103, 553, 4 |
| zoom 17.5 | 3,513 | 475 | 2 | 3,177, 475, 2 |
| zoom 18.5, boulevard | 5,327 | 490 | 1 | 6,708, 490, 2 |
| zoom 17.5, pitch 40 | 4,156 | 677 | 2 | 4,705, 677, 2 |
| zoom 17.5, phone | 1,247 | 119 | 2 | 1,709, 119, 2 |

Both wave checks pass (still under reduce-motion, moving otherwise), the onboarding hint and
the route panel (4 routes, 363,142 canyon edges) as before. PASS, basemap loaded on every view.

The arrows the GPU draws are the same as in sprint 1 at every street view (553, 475, 490,
677, 119) and within 0.1 % at the city view (2,592 against 2,591); what changed is how many
are built off screen. Tiles at first paint: 32 on desktop (28 before; the box holds the
centred 0.12° window, one tile column more), 12 on a phone (16 before).

Two harness fixes on the way (both in `scripts/shots.mjs`): each shot waits for the basemap
to finish loading (the first run had a city shot with no basemap after a fixed 2.5 s), and
for the building chunks (`buildingsPending` in the probe), since the worker parses while the
page sits still and the reduce-motion check took that for rest.

## 3. Visual polish

### Completed 2026-11-20 — commits 656e74d, a6d3dcf

- Legend: one grid, so "Strongly channelled" stays on one line and the ranges line up; the
  explanations moved to each band's tooltip and accessible name. 620 px wide before, at
  most 300 px now.
- Forecast panel: two rows (title and hour, then the numbers); the title was cut to
  "WIND FORECA…" when gust, rain and lights were all shown.
- Phone top bar: "WSW · 21:00" on one line; "from WSW · 21:00" broke after "WSW".
- Phone credit: OpenFreeMap on a second line, as its terms ask.
- Phone: the legend pill and the credit sit 8 px above the forecast panel's measured height;
  at a fixed 118 px they had ended up over the taller panel (a6d3dcf).

Needs eyes on the preview: the legend without the one-line explanations (hover a band name),
and the forecast panel's two rows on a phone.

## 4. Clean-up

### Completed 2026-11-20 — commit 7931ab4, and on the laptop

- GitHub: deleted `fix/canyon-boundary-layer`, `fix/map-legibility`, `fix/wind-scale-calibration`,
  `qa/wind-addons-preview` (all merged into `main`) and `fix/ranker-objective` (every commit
  patch-equivalent in `main`, `git cherry`). `origin` now holds `main`, `sprint-1`, `sprint-2`.
- Laptop: deleted `feat/canyon-vortex`, `fix/map-legibility`, `fix/road-band` (merged) and
  `feat/bike-type` (patch-equivalent); the stray `cph-wind-status.md`, `decisions.md`,
  `sprint-1.md` and the three sprint 1 patches at the repo root.
- Left for DJ: local copies of the four merged remote branches above and
  `feat/route-panel-redesign`, which is not merged.
- Tests get 20 s each (`vitest.config.ts`): on the laptop under load five tests that read
  the real data hit Vitest's 5 s limit; all passed with a longer one.
