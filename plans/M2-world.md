> **Status 2026-10-08: revise before starting.** Written 2026-09-06. `docs/decisions.md`
> supersedes parts of it: D1 (foundations first, so this milestone waits for Sprints 1 and 2)
> and D4 (Copenhagen's data leaves the repo as well, pinned by `data.lock.json`, so "Its data
> stays in the repo" no longer holds). Sprint 1 also adds `src/data/base.ts` with `dataUrl()`,
> which W1 extends instead of creating.

# cph-wind — Milestone 2: the world

Written 2026-09-06 from the city ranking in `docs/world/ranking.xlsx` (the "First batch" sheet)
and the coverage probe described under Step W0. Milestone 1 (Copenhagen, steps 0–9) is complete
and lives in `PLAN.md`; nothing there is reopened here. Do the steps in the order below. W0 and
W3 have no dependencies on each other; everything after W1 depends on W1.

The decision this milestone implements, in one paragraph. Wind for every city is three different
things. The forecast is already global (MET Norway's Locationforecast serves the planet: a 2.5 km
Nordic model at home, ECMWF's ~9 km model elsewhere). Streets with a bearing exist everywhere in
OpenStreetMap. Building heights, the thing that makes the wind street-level, are tagged for a
minority of buildings even in Copenhagen (see the finding under W0) and the pipeline has always
filled the rest by building type. So coverage is tiered, and the tier is shown to the rider:

| Tier | What the rider gets | What it needs | Where |
|---|---|---|---|
| A | The Copenhagen experience: canyon per street from footprints + tagged-or-default heights, the lattice, routing, timing | A city build (W2) with footprint density at or above the gate in W0 | The first batch, then city by city |
| B | Same as A but heights from a 100 m mean-height raster where tags are absent | A city build with GHS-BUILT-H (W2b) | Cities whose footprints exist but whose heights are untagged |
| C | Forecast wind projected onto every street's bearing, drawn on the basemap's own roads; tap a street; the timing panel. No canyon, no routing | Nothing: no data run, no storage | Everywhere, from W3 |

The thing that must not change: Copenhagen. Its data stays in the repo, its harness views stay,
and every step's acceptance includes the Copenhagen shots passing unchanged.

---

## Do not

- Do not run two Overpass workers, ever. The public instance cut the review session off on
  2026-09-06 after twelve rapid queries plus a second worker. One query at a time, three seconds
  between queries, `[timeout:60]`, and on a 429 or a network failure wait ten minutes before the
  next attempt. Three failures in a row: stop and report.
- Do not commit city data other than Copenhagen's into this repo. Built cities go to object
  storage (W1). The repo must stay clonable in under a minute.
- Do not touch `src/math/index.ts`. The canyon model is dimensionless in λ and needs no change
  for another city.
- Do not remove or weaken the Copenhagen harness views in `scripts/shots.mjs`.
- Do not start a dev server; `npm run shots` is the only way to look at the app (see `CLAUDE.md`).

---

## Step W0 — Measure coverage before choosing cities

### Why

The ranking (`docs/world/ranking.xlsx`, sheet "First batch") orders 93 cities in cycling
countries by riders × mean wind: population × cycling share × NASA POWER WS10M (2001–2020). It
says where the riders and the wind are. It does not say whether OpenStreetMap has the streets and
footprints a city build needs. That is measured here, once, for every candidate, and the result
decides the batch.

The finding that shapes this step: on 2026-09-06 a 5 × 5 km box around Copenhagen's centre held
15,480 OSM building ways, 158 with `height`, 2,668 with `building:levels` and 17,592 highway
ways. `scripts/fetch-buildings.mjs` gives the untagged 82 % a height by building type (9 m
residential, 18 m office; see `DEFAULT_HEIGHT_BY_TYPE`). So the "per-building" tier is footprints
plus tagged-or-default heights, and the gate for a city build is footprint density, not height
coverage. The same box in Shanghai held 11,981 buildings (67 with height), Beijing 8,852 (511),
Shenzhen 3,638 (112), Guangzhou 6,379 (23).

### Changes

`scripts/world/coverage.mjs`:

- Reads `docs/world/cities.csv` (columns: `rank, name, cc, geonameid, lat, lon, population,
  share, share_src, ws, riders, score`; exported from the ranking workbook, "First batch" sheet
  plus the twelve probes plus Copenhagen as the reference row).
- For each row builds a 5 × 5 km box centred on `lat, lon` (Δlat = 2.5/111.32°,
  Δlon = 2.5/(111.32·cos lat)°) and runs one Overpass query returning four counts:

  ```
  [out:json][timeout:60];
  way["building"](S,W,N,E)->.b; .b out count;
  way["building"]["height"](S,W,N,E)->.h; .h out count;
  way["building"]["building:levels"](S,W,N,E)->.l; .l out count;
  way["highway"](S,W,N,E)->.r; .r out count;
  ```

  with the politeness rules under "Do not". Results are appended to
  `docs/world/coverage.csv` as they arrive (`geonameid, buildings, with_height, with_levels,
  highways, measured_at`), so a stopped run resumes where it left off (skip rows already
  present).
- Derives per city: `buildings_per_km2 = buildings / 25`, `tagged_share =
  (with_height + with_levels) / buildings`, `highways_per_km2 = highways / 25`.
- Writes `docs/world/coverage.md`: the table sorted by ranking, with the tier each city qualifies
  for under the gate below, and Copenhagen's row first as the reference (619 buildings/km², 18 %
  tagged, 704 highway ways/km²).

The gate (a constant block at the top of the script, with these values):

| Qualifies for | Rule |
|---|---|
| A or B build | `buildings_per_km2 >= 300` and `highways_per_km2 >= 300` |
| A (heights tagged) | build gate and `tagged_share >= 0.30` |
| B (heights from raster) | build gate and `tagged_share < 0.30` |
| C only | anything else |

Half of Copenhagen's density is the floor because the canyon model degrades gracefully with
missing buildings (a missing wall reads as open, which is the safe direction) but a street with no
footprints on either side for most of its length is Tier C in a Tier A costume.

### Acceptance

- `node scripts/world/coverage.mjs` completes for all rows or stops with the reason in its last
  line; the run log is committed as `docs/world/coverage.log`.
- `docs/world/coverage.md` exists, Copenhagen's row matches the numbers above within 5 % (OSM
  moves), and every row carries a tier.
- The first batch is the top 20 rows that qualify for A or B, in ranking order. Write them to
  `docs/world/batch-1.csv`. Record the list in this file under this step's Completed block.

### Auto mode

This step can run unattended. Expect 10–15 minutes at one query per three seconds. Commit the
three files under `docs/world/` on a branch `world/w0-coverage` and open a PR; do not merge to
`main` (the PR is the report).

---

## Step W1 — Data addressing for more than one city

### Why

Everything in the app assumes one city: the camera lock `GCPH` in `App.tsx`, the tile manifest
at `/data/segtiles/index.json` with its own origin `(12.34, 55.54)`, the monolithic
`/data/cph-roads.json` (12 MB) and `/data/canyon-by-way.json` (2.5 MB), the 42 MB
`cph-buildings-slim.json`, and the hash-route parser that accepts only 55–56° N, 12–13° E.
Copenhagen's data is 135 MB in `public/data/` and is committed; fifty cities cannot be.

### Changes

**Tile keys become global.** `scripts/tile-segments.mjs` and `tileKeysForBounds` in `App.tsx`
move to a fixed world origin: `col = floor((lon + 180) / TILE_DEG)`, `row = floor((lat + 90) /
TILE_DEG)`, `TILE_DEG = 0.02` unchanged. Keys stay `"{col}_{row}"`. The Copenhagen tiles are
regenerated under the new keys (`node scripts/tile-segments.mjs` reads the committed
`cph-segments.json` intermediate as before; if it is absent, regenerate it with
`node scripts/compute-cross-sections.mjs`, which does not touch Overpass).

**A world index and per-city indexes.**

```
data/world/index.json            { cities: [{ slug, name, cc, lat, lon, bbox:[W,S,E,N], tier:"A"|"B", icao?, builtAt }] }
data/world/{slug}/index.json     { tileDeg, tiles:[keys], roads:"roads.json", canyon:"canyon-by-way.json", buildings?:"buildings-slim.json" }
data/world/{slug}/segtiles/{key}.json
data/world/{slug}/roads.json
data/world/{slug}/canyon-by-way.json
data/world/{slug}/buildings-slim.json   (optional; desktop 3D only)
```

Copenhagen becomes `data/world/copenhagen/…` inside the repo (`public/data/world/copenhagen/`),
and the old top-level files are deleted in the same commit. Nothing else in the repo may
reference `cph-roads.json`, `cph-buildings-slim.json` or `segtiles/index.json` afterwards
(`grep -rn "cph-roads\|cph-buildings-slim\|segtiles/index" src scripts` must return nothing but
the pipeline scripts' output paths).

**A base URL.** `src/data/base.ts` exports `dataUrl(path)`: `${import.meta.env.VITE_DATA_BASE_URL
?? "/data"}/${path}`. Every `fetch("/data/…")` in `src/` goes through it. In production
`VITE_DATA_BASE_URL` points at the object-storage bucket (W7 sets it); the world index is fetched
from there, and any city whose per-city index 404s is treated as not built (Tier C). Copenhagen's
files are also uploaded to the bucket so production reads one place; the in-repo copy is what
`npm run shots` and the tests use.

**The app picks a city from the viewport.** `src/data/cityIndex.ts`: load the world index once;
`cityAt(lon, lat)` returns the city whose bbox contains the point (the smallest if several).
`App.tsx` keeps `activeCity` in state, updated when the viewport centre crosses a bbox edge,
debounced 500 ms. Roads, the canyon table and the 3D buildings are loaded per `activeCity` and
released when it changes. The tile-loading effect keys tiles by `activeCity.slug`.

**The camera lock goes.** `GCPH` and `constrainView`'s longitude/latitude clamps are removed;
`MIN_ZOOM` becomes 3. Arrows appear from zoom 13 as now; below that the map shows the basemap
and, once W3 lands, nothing else. The hash-route parser accepts any finite lat/lon with
|lat| ≤ 85. `COPENHAGEN` stays the default opening view; `LocationSearch` (Photon) already
geocodes anywhere.

### Acceptance

- `npm run check` and `npm run build` green; every test that referenced the old paths updated.
- `npm run build && npm run shots -- w1` passes with the Copenhagen views unchanged: same arrow
  counts within 2 % of the Step 5h report, panel-routes planned, canyonEdges > 0.
- A new harness view `world-index` opens the app with `#z=4&lat=50&lon=10`, asserts no page
  error and that `window.__cphwind.city` is `null` there and `"copenhagen"` on the opening view.
  Add `city` (the active slug or null) to the probe.
- No file under `public/data/` is larger than 45 MB (Vercel's static limit is comfortable above
  that; the point is that nothing new is committed).

---

## Step W2 — Build any city

### Why

The pipeline is Copenhagen by constant: `BBOX` in `fetch-osm.mjs` and `fetch-buildings.mjs`,
`CPH_LAT`/`CPH_LON` for the local projection in `compute-cross-sections.mjs`, fixed input and
output paths everywhere. A city build must be one command with a slug.

### Changes

`scripts/world/build-city.mjs <slug>`:

1. Reads the city's row from `docs/world/batch-1.csv` (or `docs/world/cities.csv`) and derives a
   bbox: the GeoNames point ± a radius that scales with population,
   `r_km = clamp(6 + 4·log10(population / 100000), 6, 18)`, so a 250k city gets ~7.6 km and a
   4 M city ~12.4 km. Copenhagen's existing bbox stays as its override (`bbox` column, optional).
2. Runs the three existing scripts as functions with parameters instead of constants:
   `fetchRoads(bbox, outPath)`, `fetchBuildings(bbox, outPath)`,
   `computeCrossSections({ roadsPath, buildingsPath, outPath, originLat, originLon })`. The
   scripts keep their command-line entry points for Copenhagen (`npm run data:rebuild` must still
   work and produce byte-identical output for Copenhagen; a test compares a checksum of
   `canyon-by-way.json` before and after the refactor).
3. Tiles with the global keys, writes the per-city index, `roads.json` (only the properties
   `id, name, highway, cycleway, width`, coordinates rounded to 1e-6; expect ~40 % of today's
   size), `canyon-by-way.json`, and `buildings-slim.json`, all under `data-out/{slug}/` (gitignored).
4. Appends the city to a local `data-out/index.json` with `tier` from W0's coverage table.

Overpass politeness applies (one query at a time; the roads and buildings queries of one city are
two queries, three seconds apart). A city's two queries take 20–120 s. Twenty cities is an hour.

`scripts/world/upload.mjs <slug|--index>`: uploads `data-out/{slug}/**` to the bucket with
`Content-Type: application/json`, `Cache-Control: public, max-age=86400`, then re-uploads the
merged world index last, so the app never sees a city listed whose files are still arriving.

### Heights (W2b, inside this step)

`fetch-buildings.mjs` gains a fourth source between `building:levels` and the type default: a
mean-height raster lookup when `GHS_BUILT_H_PATH` is set. GHSL GHS-BUILT-H (R2023A, 100 m,
epoch 2018, "ANBH" average net building height) is one global GeoTIFF; the script reads the cell
at the building centroid with a small pure-JS GeoTIFF reader (`geotiff` on npm) and uses it when
it is ≥ 3 m. `hSrc` gains the value `"raster"` and the build log reports the four-way split. Cities
where the raster is used for more than half the buildings are Tier B in the index. If the raster
is not present the step degrades to today's behaviour and says so in the log; it is not a
failure.

### Acceptance

- `node scripts/world/build-city.mjs copenhagen` reproduces the committed Copenhagen data:
  identical `canyon-by-way.json` checksum, identical tile count, segment count within 0.1 %.
- `node scripts/world/build-city.mjs malmo` (Malmö: 362k, 26 % share, 5.9 m/s, the nearest
  first-batch city) completes and its log states buildings, height sources, segments, tiles.
- A unit test for the bbox rule at the three populations above.
- Nothing under `data-out/` is committed.

---

## Step W3 — Tier C: the field on the basemap's own roads, everywhere

### Why

Tier C is most of the planet and needs no data of ours. MapLibre already has the road geometry of
whatever is on screen: the CARTO basemap is vector tiles, and `map.querySourceFeatures(source,
{ sourceLayer })` returns the road LineStrings currently loaded, with a `class` property
(motorway, trunk, primary, secondary, tertiary, minor, service, path …). From zoom 13 those lines
are complete enough to carry the lattice. So outside a built city the app draws the same arrows
from the same forecast, with λ = 0 (no walls: the boundary-layer factor alone), on streets it did
not have to fetch.

### Changes

`src/data/basemapRoads.ts`:

- `discoverRoadLayer(map)`: from `map.getStyle()`, the vector source and the `source-layer` used
  by the style's road line layers (the recolouring code in `App.tsx` already matches their ids
  with `/(road|street|bridge|tunnel|transit|rail|highway|path)/`). Log the source id and
  source-layer once; if none is found, Tier C is off and the top bar says "no street data here".
  Do not hard-code `"transportation"`; read it.
- `roadPiecesFromBasemap(map, bounds)`: query the features, drop `class` values `rail`,
  `transit`, `ferry`, `aerialway`, `motorway` (no cycling), resample every line into 30 m pieces
  exactly as `compute-cross-sections.mjs` does (`STEP_M = 30`, `MIN_COVERAGE_M = 6`), and emit
  `Segment` objects with `bearingDeg`, `segmentLengthM`, `widthM` from a class table
  (primary 18, secondary 14, tertiary 11, minor 9, service 6, path 3, matching `WIDTHS` in the
  pipeline), `leftHeightM = rightHeightM = 0`, `geometrySource: "fallback"`, `wayId` from the
  feature id, `classRank` from the class. Cache by tile id so a pan does not recompute.
- `App.tsx`: when `activeCity` is null and zoom ≥ 13, `visibleSegments` comes from
  `roadPiecesFromBasemap` instead of tiles; the lattice, the road band and the tap tooltip work
  unchanged because they consume `Segment`. Route planning is disabled with the panel copy
  "Routes need a built city. Copenhagen and the first batch have one; here the map shows the
  wind on every street." Timing (the slider and best window) works: it only needs the forecast.
- The top bar shows the tier: "Street detail: measured" (A), "estimated heights" (B), "forecast
  on streets" (C). Copy in `src/cyclist/routeCopy.ts` style: one noun phrase, no sentence.

### Acceptance

- New harness views, wind `sw4`: `tierc-amsterdam` (`z=17&lat=52.3702&lon=4.8952`, arrows ≥ 150),
  `tierc-tokyo` (`z=17&lat=35.6812&lon=139.7671`, arrows ≥ 150), `tierc-bogota`
  (`z=17&lat=4.6533&lon=-74.0836`, arrows ≥ 100). They pass only when the basemap loaded (the
  report says so); on an offline machine the step cannot be verified and must say so.
- `window.__cphwind.tier` is `"C"` on those views and `"A"` on the Copenhagen views.
- Copenhagen views unchanged.
- A unit test on `roadPiecesFromBasemap` with a fixture of three synthetic LineStrings: piece
  count, bearings, widths.

### Auto mode

Runs unattended. The one judgement a person must make is whether the lattice on basemap roads
looks like the Copenhagen lattice; list the three Tier C shots as needing eyes.

---

## Step W4 — The forecast proxy for the world

### Why

`api/wind.ts` keys its CDN cache on four-decimal coordinates (11 m). Two riders on the same
street miss each other's cache entry; a world of riders means a MET call per rider. MET's terms
allow this but ask for caching, and the proxy is the only server cost the app has.

### Changes

- Round `lat` and `lon` to two decimals before building the MET URL and the cache key
  (≈1.1 km; the Nordic model cell is 2.5 km, ECMWF's 9 km, so nothing is lost).
- Keep the `Expires`-driven `s-maxage`; add `stale-if-error=3600` so a MET outage serves the last
  forecast rather than an error.
- Log nothing per request (Vercel function logs are the cost).

### Acceptance

- `src/api/weather.test.ts` gains a test that two requests 300 m apart produce the same proxy
  URL.
- `npm run build` green; the harness (which mocks `/api/wind`) unchanged.

---

## Step W5 — Routing in any built city

### Why

The routing graph is built client-side from the city's `roads.json` joined to
`canyon-by-way.json` (Step 2b). With W1 both are per city; the worker just needs to be told which.

### Changes

- `RoutePanel` and `routingWorker.ts` take the city slug; the worker rebuilds its graph when the
  slug changes and answers "no city" when it is null.
- `sharedRouteFromHash` sets `activeCity` from the start point before routing.
- Route bounds: both ends must lie inside the active city's bbox; otherwise the panel says "Both
  ends need to be in {city}."

### Acceptance

- `panel-routes` unchanged for Copenhagen.
- A second shared-route harness view for the first built batch city (W7 fills the coordinates).

---

## Step W6 — Validation everywhere there is an airport

### Why

`scripts/validate-wind.mjs` compares MET against METAR at EKCH and DMI stations hourly. METAR is
global; the same comparison should run for every built city so the deck's "checked hourly
against observations" stays true as cities are added.

### Changes

- The world index carries an `icao` per city (the main airport; EKCH for Copenhagen, ESMS for
  Malmö, EHAM for Amsterdam, EDDB for Berlin, EDDH for Hamburg, EHRD for Rotterdam, EHGG for
  Groningen). The validation script samples every listed ICAO in one METAR request
  (`ids=EKCH,ESMS,…`) and MET at each airport's coordinates; DMI stays for Copenhagen only.
- The log line gains `city`.

### Acceptance

- One manual run appends rows for every listed city; the workflow file is unchanged except the
  script reading the index.

---

## Step W7 — The first batch, live

### The one human action

Create the bucket. Cloudflare R2 (10 GB free, no egress fees, public bucket with a custom
domain or the `r2.dev` URL, CORS allowing `https://cph-wind.vercel.app` and the preview
domains). Put its URL in Vercel as `VITE_DATA_BASE_URL` for production and previews, and an
R2 API token in the local environment for `upload.mjs`. Vercel Blob is the alternative if one
vendor is preferred; the upload script has a driver for each and a `DATA_DRIVER` env selects it.

### Changes

- Build and upload Copenhagen and the first five of `batch-1.csv`, one at a time, verifying
  each city's index is reachable from the bucket URL before starting the next.
- Add each city's harness views to `docs/world/harness-views.json` (`city-desktop`, `z17.5`,
  `z18.5`, `panel-routes` with a route between two named streets), and teach `scripts/shots.mjs`
  a `--city <slug>` argument that reads them.
- Then the remaining fifteen, unattended, at the Overpass pace.

### Acceptance

- `npm run shots -- w7 --city malmo` (and the other four) pass: arrows drawn, route planned,
  `tier` reported, basemap loaded.
- Production, with `VITE_DATA_BASE_URL` set, opens on Copenhagen exactly as before (harness
  against the preview URL through the branch preview link, judged by a person).
- `docs/world/coverage.md` gains a "built" column with the build date and the tier the index
  carries.

---

## What this milestone does not do

- Planet-wide street tiles of our own (Tier C uses the basemap's roads instead). If a basemap
  change ever breaks W3, the fallback is a planetiler profile emitting road pieces, and that is
  its own milestone.
- Calibration. The coefficients stay literature priors in every city. Calibration is the
  deck's step 1 and a separate milestone.
- Languages. The UI stays English.

---

## Reporting

Each step ends with a Completed block here in the PLAN.md style: date, commit, test count, the
harness numbers, and which shots need eyes. A step that cannot be completed stops and reports
what it saw (the Overpass response, the missing layer, the 404) rather than working around it.
