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
