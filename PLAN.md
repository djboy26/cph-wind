# cph-wind — Ranker fix and panel rebuild

Written 2026-09-03. Scoped deliberately. Do the steps in order. Step 3 depends on step 1's tie flag and on step 2's corrected wind.

---

## Step 0 — Land the stranded branch first

`qa/wind-addons-preview` has never been merged. Verified 2026-09-03:

```
git log --oneline origin/main --not qa/wind-addons-preview -- src/   ->  (empty)
git diff --stat qa/wind-addons-preview origin/main -- src/           ->  +183 / −1115
```

Zero source commits exist on `main` that the branch lacks. **`main` is a strict subset of qa for
everything under `src/`.** The 85 days of commits on `main` are all
`chore: wind-validation sample [skip ci]` from `github-actions[bot]` — data appends, no code.

What is sitting unshipped on the branch:

| file | lines | what it does |
|---|---|---|
| `components/TimeSlider.tsx` | 170 | scrub the next ~24 h of forecast; drives arrows, routing and top bar |
| `cyclist/solar.ts` | 78 | sunrise/sunset, night shading, "you'll need lights" |
| `cyclist/advisory.ts` | 63 | one ranked safety chip: ice, severe wind, gusts, heavy rain, heat |
| `cyclist/bestWindow.ts` | 52 | "best window 16:00 · lighter wind & less rain", 6 h horizon |
| `cyclist/feelsLike.ts`, `monitoring.ts`, `components/Advisory.tsx` | 90 | supporting |
| their tests | ~185 | |

```powershell
git checkout main
git merge origin/main --ff-only          # take the bot's data commits
git merge qa/wind-addons-preview -m "Merge branch 'qa/wind-addons-preview' into main"
npm run check                            # lint + vitest run
npm run build
```

**Never invoke `npm test` from an agent.** It maps to bare `vitest`, which is watch mode and will
hang forever waiting for file changes. Use `npm run check` (lint + `vitest run`) or `npm run test:run`.

Completed 2026-09-03 as merge commit `66b2b18` (parents `a2a0616`, `cd4c45c`). 76 tests green.

Check the Vercel preview before pushing to `main`, because a push to `main` deploys straight to
production and this merge ships five user-visible features at once. Branch the ranker fix from the
merged `main` afterwards.

Working tree was clean at `cd4c45c` when this was written.

---

## Do not touch: `src/math/index.ts`

`bearing()` and `resistance()` were cross-checked on 2026-09-03 against an independently written
oracle across 25,920 street-orientation × wind-direction pairs:

| function | max disagreement |
|---|---|
| `bearing()` | 5.7 × 10⁻¹⁴ ° |
| `resistance()` | 4.1 × 10⁻¹⁵ m/s |

The cos(mean-latitude) correction, the `(directionDeg + 180) % 360` travel vector, and the
`+headwind` sign convention are all correct. `URBAN_BL_CORRECTION = 0.6` matches the open-terrain
log law from 10 m to 1.5 m (0.673 for z₀ = 0.03 m) and is defensible. The Soulhac canyon model
sits on top of it correctly.

**The bearing and resistance maths is not the bug. Do not refactor it, do not re-derive it, do not
"fix" the bearing formula or flip the `+headwind` sign convention.**

There *is* one real defect in this file — `streetLevelWind()` is never applied inside
`canyonModifiedWind()`. It has its own step (step 2) with its own tests. Fix it there, deliberately.
Do not fix it opportunistically while doing step 1.

---

## Step 1 — Fix the ranker

**File:** `src/routing/windRoute.ts`

### The bug

`rankRoutes()` scores `recommended` as a weighted blend of three min-max-normalised metrics.
`normaliser()` rescales every axis to 0..1 regardless of the real spread, so 60 s of time difference
and 0.3 m/s of wind difference both consume the full range. Since
`exposure (0.35) + avgWind (0.20) = 0.55 > time (0.45)`, the wind axes outvote time whenever they
agree, however trivial the wind gap.

Reproduced exactly against production on 2026-09-03, wind 3.1 m/s SSW:

| | t_norm | e_norm | a_norm | score |
|---|---|---|---|---|
| Route 1 · 1.77 km · 1.1 m/s · 61% | 1.00 | 0.00 | 0.00 | **0.450 ← picked** |
| Route 2 · 1.39 km · 1.4 m/s · 77% | 0.00 | 1.00 | 1.00 | 0.550 |
| Route 3 · 1.69 km · 1.1 m/s · 71% | 1.00 | 0.62 | 0.00 | 0.669 |

Route 3 has identical average headwind to Route 1 and is 80 m shorter, so Route 1 is **strictly
dominated** and still won. There is a second problem underneath: `timeS` already contains the wind
via `effectiveSpeed()`, so adding `headwindExposure` and `avgHeadwindMs` counts the same wind
three times.

### Changes

1. **Delete `normaliser()`** and the whole `criterion === 'recommended'` branch in `rankRoutes()`.
2. **`recommended` becomes an alias of `timeS`.** It is already wind-adjusted. The `Fastest`
   criterion is currently the only correct one in the file.
3. **Add a tie rule.** Extend the return of `rankRoutes()`:
   ```ts
   { sorted, bestId, windIsSimilar: boolean }
   ```
   `windIsSimilar` is true when `max(windDeltaS) − min(windDeltaS) < 15` across the options.
   When true, sort by `distanceM` instead of `timeS` and let the UI say so.
4. **Raise `windSensitivity` from 0.4 to 0.5** in `DEFAULT_PARAMS`. Solving the constant-power
   equation at 18 km/h, C_dA 0.40, 90 kg gives 0.52 for the first m/s of headwind and ≈0.49
   averaged to 3 m/s. Leave a comment saying where the number came from.
5. **Keep `headwindExposure` on `RouteMetrics`.** It stops being a ranking input; it may still be
   useful for the tooltip. It leaves the UI (step 2).

### Regression tests — `src/routing/routing.test.ts`

Pin the live case so this cannot come back:

```
given wind 3.1 m/s from 202.5° (SSW) and three routes
  A: 1770 m, avg headwind 1.1 m/s
  B: 1390 m, avg headwind 1.4 m/s
  C: 1690 m, avg headwind 1.1 m/s

rankRoutes(..., 'recommended').bestId  ===  B
windIsSimilar                          ===  true      // windDeltaS spread is 2 s
```

Also assert the dominance rule directly: a route that is longer than another with equal or worse
`avgHeadwindMs` and equal or worse `timeS` must never rank first, for any input.

Second case, to prove the fix does not just collapse to "always shortest":

```
given a strong wind where
  A: 1390 m, avg headwind 4.0 m/s   -> timeS ≈ 409 s, windDeltaS ≈ +131 s
  B: 1690 m, avg headwind 1.2 m/s   -> timeS ≈ 374 s, windDeltaS ≈  +36 s

bestId === B     // the longer route legitimately wins
windIsSimilar === false
```

---

## Step 2 — Unify the wind model (the map and the router disagree)

**File:** `src/math/index.ts`, then `src/routing/windRoute.ts`

### The bug

`streetLevelWind()` — the `× 0.6` reduction from the 10 m met reference down to rider height —
appears at exactly two places in `math/index.ts`, lines 78 and 98, inside `resistance()` and
`alongStreetWind()`. **It is never applied inside `canyonModifiedWind()`.**

So the two halves of the app compute different winds for the same tarmac:

| | path | what it does |
|---|---|---|
| **Map arrows** | `buildWindArrows` → `computeSegmentCenterWind` → `asymmetricCanyonWindAtLane` → `canyonModifiedWind` | raw 10 m wind × up to 1.45, **no boundary-layer reduction** |
| **Route panel** | `edgeHeadwind` → `resistance` → `streetLevelWind` | 10 m wind × 0.6, **no canyon geometry at all** |

At the measured median λ = 0.34 on a street aligned with the wind, the arrows draw **1.10 ×** ambient
while the router computes **0.60 ×** ambient. A 3.3 m/s day renders as 3.6 m/s on the map and 2.0 m/s
in the route panel. In a deep canyon (λ ≥ 1.5) the ratio reaches **2.4 ×**.

The amplification is also wrong against its reference level. Street-level wind inside an urban canopy
should essentially never exceed the open-terrain 10 m value. Channeling makes the along-street
component *less reduced* than the cross component; it does not lift it above free-stream.

### Changes

1. **Apply `streetLevelWind()` at the top of `canyonModifiedWind()`**, before decomposing. This alone
   fixes both problems: the effective along factor becomes `0.6 × (1 + 0.3λ)`, which maxes at
   **0.87** and is therefore always below ambient, and no cap or clamp is needed.
2. **Make sure it is applied exactly once.** `resistance()` and `alongStreetWind()` already call it.
   If routing moves onto the canyon path (below), remove the double application or the wind gets
   reduced to 0.36 ×. Add a comment naming the single point of application.
3. **Route on the canyon-modified wind.** `edgeHeadwind()` currently calls `resistance()`, which
   ignores building geometry entirely. It should use the segment's cross-section.
   **First check whether `Edge` in `routing/graph.ts` carries the cross-section fields.** If it does
   not, join them from the segment data at graph-build time rather than re-ray-casting at runtime.
   Report back before doing this if the join is not straightforward.

### Acceptance test

The single assertion that matters:

```
for a sample of >=500 real segments from public/data/segtiles, and several wind directions:
  speed drawn by computeSegmentCenterWind(seg, wind)
    ===  speed used by edgeHeadwind for the same segment and wind      (within 1e-9)
```

Plus:

```
for every lambda in [0, 0.34, 0.65, 1.0, 1.5, 2.5] and any wind:
  canyonModifiedWind(...).speedMs  <=  ambientWind.speedMs      // never manufactures energy
```

Regenerate no data. This is a pure runtime change.

### Explicitly NOT in this step

The canyon vortex. Above λ ≈ 0.65 real canyons enter skimming flow and street-level wind reverses
relative to the flow above. The current transform can only shrink the cross component toward zero,
never reverse it, so the signature behaviour of a deep canyon is absent. Adding it is a research task
with its own validation burden. Do not attempt it here.

Also out of scope: junction continuity (segments are solved independently and mass flux is not
conserved through corners) and upstream wakes (a building only matters if a 40 m perpendicular ray
hits it, so a tower 60 m upwind has no effect).

---

## Step 3 — Rebuild `RoutePanel.tsx`

Reference mockup: the published "Route Panel Redesign" artifact. Same data, 22 numbers down to 7.

### Remove

- **`% into wind`** — deleted from the view entirely. It caused the wrong recommendation and means
  little to a rider.
- **The `Rank by` pill row** — replaced by one quiet `Sort by wind` text toggle.
- **`Route 1 / 2 / 3` labels** — order carries rank; times and distances identify the rows.
- **`★` and the `Recommended` / `Shortest` badges** — a first row is already a recommendation.
- **Per-route card borders and fills** — hairline rules and vertical space instead. Cards inside a
  card inside frosted glass is three levels of container for one list.
- **The status line** (`"3 routes · ★ best for recommended"`) — replaced by the verdict sentence.

### Add

- **`windDeltaS` as the wind figure.** (Numbers will shift once step 2 lands; that is expected.)
-  `routeMetrics()` already computes it at line 79 and the UI
  has never rendered it. Format as `+35 s into the wind` / `−40 s with the wind`.
- **A verdict sentence** below the list, driven by `windIsSimilar` and, once step 0 has landed,
  by `bestRideWindow()`:
  - `windIsSimilar === false` → *"The short way costs you an extra 1 min 47 s today. Go round."*
  - `windIsSimilar === true` and `bestRideWindow()` returns null →
    *"Wind costs about 35 s whichever way you go today. Take the short one."*
  - `windIsSimilar === true` and `bestRideWindow()` returns a window →
    *"Wind costs about 35 s whichever way you go. Leave at 16:00 and it costs nothing."*

  That third case is the important one and it is why step 0 comes first. **When wind does not
  discriminate between routes it often still discriminates between hours**, and on a 1.4 km trip
  where every route costs the same, *when to leave* is the better answer than *which way to go*.
  `bestRideWindow()` already computes it, with a conservative 1.2-unit improvement threshold so it
  stays quiet unless the gain is real. Wire it into the verdict rather than writing anything new.

  The `TimeSlider` also means route metrics are no longer a function of current wind alone. Take the
  wind for the selected forecast hour, not `useCurrentWind()`, and label the panel when the selected
  hour is not "now".
- **A footer line** showing the active rider default: `Commuter bike, 18 km/h`, tappable (step 4).

### Layout

Each row: time at 24 px / 600 weight on the left, distance small and grey on the right, wind delta
beneath the time at 12.5 px. `font-variant-numeric: tabular-nums` throughout. Rows separated by
`1px solid var(--hairline)`, no border on the last.

### Surface

Make the route sheet **opaque**. `glass` is `rgba(255,255,255,0.72)` with a 20 px backdrop blur, so
street labels and building fills currently show through body text. Outdoors on a phone that is a
legibility problem before it is an aesthetic one. Keep `glass` on the small floating wind chip,
where nothing has to be read at length.

Keep Inter. The typeface is the least important part of this change.

---

## Step 4 — Retire the red/green semantic pair

**File:** `src/components/ui.ts`

`good: #1f9d57` against `bad: #e0533d` carries the tailwind/headwind distinction, which is the most
important signal in the app, using the one colour pair that roughly 8% of men cannot separate.

```
good: "#1f9d57"  ->  "#2e7488"    // teal
bad:  "#e0533d"  ->  "#b0522e"    // rust
```

Apply the same rotation to the five-stop map wind scale, which currently runs
teal → green → amber → orange → magenta. Green→amber→orange is three steps that collapse into one
under deuteranopia. Check a simulated screenshot before merging.

---

## Step 5 — Bike-type picker

Only after steps 1-4. Sets `baseSpeedMs` and `windSensitivity` together in `CyclingParams`:

| type | baseSpeedMs | windSensitivity |
|---|---|---|
| City / omafiets | 4.2 (15 km/h) | 0.55 |
| Commuter / hybrid *(default)* | 5.0 (18 km/h) | 0.50 |
| Road bike | 7.2 (26 km/h) | 0.42 |
| E-bike | 6.7 (24 km/h) | 0.15 |

E-bike is a separate row for a physical reason: the motor holds speed into a headwind, so wind costs
battery range rather than legs and `windSensitivity` collapses toward zero.

**Do not ask for rider weight.** Mass enters only through rolling resistance, which is
wind-independent, so it cancels completely out of the extra power a headwind costs. A 70 kg and a
110 kg rider both lose 91.9 W to a 5 m/s headwind at 18 km/h. Weight changes only the
equivalent-gradient readout, and there it runs backwards from intuition (2.68% at 70 kg, 1.70% at
110 kg for the same wind).

Never gate the map behind the picker. Default first, adjust later.

---

## Verification before merge

1. `npm run check` green (lint + `vitest run`), including both new regression cases. Never `npm test` — it is watch mode and hangs.
2. `npm run build` clean.
3. Vercel preview deployed; paste the URL.
4. Open the preview beside `wind-math-bench.html` (in `~/copenhagen-wind-map/`) with the same live
   wind and confirm the head/tail verdict agrees on five named streets.
5. Screenshot the route panel on a phone viewport, calm day and windy day.
6. Deuteranopia simulation of one map screenshot.

## Out of scope

Validating the canyon model against ground truth. That needs DMI station data or manual anemometer
readings and is its own milestone. The meta description already claims "modified by urban canyon
channeling around buildings" — that claim needs a residual number behind it eventually, but not in
this change.
