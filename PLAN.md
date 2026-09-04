# cph-wind — Ranker fix and panel rebuild

Written 2026-09-03, reviewed 2026-09-04. Scoped deliberately. Do the steps in order. Step 4 depends on step 1's tie flag and on step 2a's corrected wind.
Step 3 exists because step 2a invalidated the scale it recalibrates.

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

**Scope of the "a failing test means the code is wrong" rule.** It applies to tests that pin the
verified maths above — bearing, resistance, the travel vector, the sign convention. It does **not**
apply to a test that encodes behaviour a step is deliberately changing. When a step's stated intent
and an existing test disagree, the test is describing the old behaviour: update it, rename it
honestly, comment why, and say so in your report. Stopping to flag the collision is right; treating
the rule as absolute and abandoning a correct change is not.

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

### Completed 2026-09-03 — commit `9b3510d`, branch `fix/ranker-objective`

`normaliser()` and `RECOMMENDED_WEIGHTS` deleted. `rankRoutes()` returns `windIsSimilar` and every
comparator breaks ties on the opposite axis. `windSensitivity` 0.5 with the derivation in a comment.
`npm run check` green: lint clean, **81 tests** (was 76). `src/math/index.ts` untouched.

Verified independently across wind regimes, not just the pinned case:

| ambient | windDeltaS spread | windIsSimilar | ranks by | winner |
|---|---|---|---|---|
| 3.1 m/s (pinned) | 3.5 s | true | distance | B, 1.39 km |
| 3.9 m/s (live) | 5.1 s | true | distance | B |
| 7.0 m/s | 16.8 s | false | time | B |
| 12.0 m/s | 78.2 s | false | time | C, 1.69 km |

The threshold crosses between 3.9 and 7 m/s without changing the answer, and at gale force the
longer sheltered route legitimately wins. The fix does not collapse to "always shortest".

**Follow-up, not urgent:** `windIsSimilar` is computed from absolute `windDeltaS` seconds, and
`windDeltaS` scales with route length. Two routes in identical wind but very different lengths read
as "not similar". Harmless for A→B alternatives, which cluster within ~30% of each other, and the
`timeS` fallback still ranks correctly when it trips. Add a comment so nobody later reads the flag
as "the wind is the same on these routes".

---

## Step 2a — Apply the boundary layer inside the canyon model

**File:** `src/math/index.ts` only. Routing is step 2b.

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
3. **Do not touch routing in this step.** Making the router use canyon geometry is step 2b and it is
   a data-join problem, not a physics problem. See below.

### Why this one line is most of the fix

| | arrows | router | gap |
|---|---|---|---|
| now | 1.102 × ambient | 0.600 × ambient | **1.84 ×** |
| after 2a | 0.661 × ambient | 0.600 × ambient | **1.10 ×** |

At the measured median λ = 0.34. Moving `streetLevelWind()` inside `canyonModifiedWind()` closes
roughly 90% of the disagreement and removes the super-ambient wind entirely, without touching the
routing graph. Deep canyons (λ = 1.5) go from a 2.42 × gap to 1.45 ×.

### Acceptance tests

```
for every lambda in [0, 0.1, 0.34, 0.65, 1.0, 1.5, 2.5] and wind from 0..350 deg step 10:
  canyonModifiedWind(bearing, {H, W}, ambient).speedMs  <=  ambient.speedMs
      // the model must never manufacture energy. This currently FAILS for
      // aligned streets at every lambda > 0.

for lambda < 0.1:
  canyonModifiedWind returns the boundary-layer-reduced wind, NOT the raw ambient.
      // the early return at the top of the function must also be reduced,
      // or 16% of central segments keep the old behaviour

streetLevelWind is called exactly once per code path:
  grep the file — it must appear in canyonModifiedWind, resistance and
  alongStreetWind, and those must not compose. resistance() does not call
  canyonModifiedWind today, so there is no double application. Verify that
  stays true.
```

Regenerate no data. This is a pure runtime change.

### Expect the map to change

Arrow speeds drop by roughly 40%. The wind-scale colours will shift toward the low end and the map
will look calmer. That is the boundary layer finally being applied, not a regression. Check a
screenshot before and after and keep both.

### Completed 2026-09-03 — commit `752f8c2`, branch `fix/canyon-boundary-layer`

`streetLevelWind()` applied once at the top of `canyonModifiedWind()`, and on the λ < 0.1 early
return, gusts included. `npm run check` green: **86 tests** (was 81). `src/routing/` untouched.

Energy test written first and confirmed failing on the unmodified model: **3168 of 9072**
combinations returned more wind than the ambient they were given, worst case 1.450 × — exactly the
`alongFactor` cap. After the fix, zero.

Independently re-verified 2026-09-03 over 6,912 combinations (λ ∈ {0, 0.05, 0.1, 0.34, 0.65, 1.0,
1.5, 2.5} × wind 0–350° × bearing 0–345°):

| λ | scale, aligned | band at 3.9 m/s ambient |
|---|---|---|
| 0.00 / 0.05 | 0.600 × | Light |
| 0.34 (median) | 0.661 × | Light |
| 0.65 | 0.717 × | Light |
| 1.00 | 0.780 × | Light |
| 1.50+ | **0.870 ×** (the bound) | Light |

Zero energy violations. Gusts scale identically to the mean on every path, early return included.
Map/router gap at the median is now **1.10 ×**, down from 1.84 ×; the remainder is channeling, which
is real physics rather than disagreement.

**One pre-existing test was changed, correctly.** `computeSegmentLanes > "open field (no buildings)"`
asserted that a 10 m/s ambient returns ~10 m/s on the λ < 0.1 path. That is the defect this step
removes. It now asserts 6 m/s under a renamed heading. See the scoping note under "Do not touch"
above — the agent flagged the rule collision rather than deciding silently, which was the right call.

**Known cosmetic gap, not worth a commit on its own:** the `speedMs < 1e-6` guard returns
`gustMs: ambientWind.gustMs` unreduced. Unreachable in practice — `crossFactor` floors at 0.05, so
reaching it needs an ambient below 2 × 10⁻⁵ m/s, and `ambientWind.speedMs <= 0` is already caught
above. Fold it into the next edit of this file.

---

## Step 2b — Route on the canyon-modified wind (NOT for auto mode)

`edgeHeadwind()` calls `resistance()`, which applies a flat 0.6 and ignores building geometry
entirely. The router should use the same canyon-modified wind the arrows use.

**This is blocked on a data join, and the join is not obvious.** Verified 2026-09-03:

- `Edge` in `routing/graph.ts` carries only `{ to, lengthM, bearingDeg, wayId, highway }`.
  No cross-section fields.
- `buildGraph()` reads `public/data/cph-roads.json`.
- The arrows read `public/data/cph-segments.json`, built separately by
  `compute-cross-sections.mjs` with `MIN_SEGMENT_M = 20`.

So the graph and the cross-sections come from two different files with no shared key beyond
`wayId`, and a way holds many edges and many segments which are **not 1:1** — short pieces are
merged or dropped by the 20 m minimum, and there is a separate coverage fallback for short ways.

Decide the join strategy with a human before writing code. The options are roughly:

1. Attach cross-sections to edges at `buildGraph()` time by matching on `wayId` plus nearest
   segment midpoint. Costs a spatial index at load.
2. Emit a single unified segment file from `compute-cross-sections.mjs` that the graph and the
   arrow layer both consume, removing the two-source problem at its root.
3. Accept per-way average cross-section for routing, which is cheap and lossy.

Option 2 is the real fix and the largest change. Do not start any of them in auto mode.

### Explicitly NOT in scope at all

The canyon vortex. Above λ ≈ 0.65 real canyons enter skimming flow and street-level wind reverses
relative to the flow above. The current transform can only shrink the cross component toward zero,
never reverse it, so the signature behaviour of a deep canyon is absent. Adding it is a research task
with its own validation burden. Do not attempt it here.

Also out of scope: junction continuity (segments are solved independently and mass flux is not
conserved through corners) and upstream wakes (a building only matters if a 40 m perpendicular ray
hits it, so a tower 60 m upwind has no effect).

---

## Step 3 — Recalibrate and repalette the wind scale

Step 2a dropped every arrow by 40%, which was correct. It also broke the scale those arrows are
coloured by, because `WIND_BANDS` was calibrated against unreduced 10 m wind.

### The scale is now mostly dead

Modelling Copenhagen's 10 m wind as Weibull(k = 2, c = 6.1), annual mean ≈ 5.4 m/s, over a
median-λ street with orientation uniform:

| band | current | share of the map | proposed | share |
|---|---|---|---|---|
| Calm | 0–2 m/s | **37.5%** | 0–1.2 | 16.2% |
| Light | 2–4 | **42.7%** | 1.2–2.4 | 32.1% |
| Moderate | 4–6 | 15.6% | 2.4–3.6 | 25.9% |
| Strong | 6–9 | 4.0% | 3.6–5.0 | 16.3% |
| Very strong | 9–12 | **0.2%** | 5.0–7.0 | 7.9% |
| Severe | 12+ | **0.0%** | 7.0+ | 1.7% |

**80.2% of the map now sits in two bands, and the top two are unreachable.** Severe needs an
ambient of 13.8 m/s even in the deepest aligned canyon, and 18.2 m/s on a median street. The legend
shows six swatches of which two carry almost everything and two never light up.

Street-level distribution after step 2a: median **2.47 m/s**, p10 0.93, p90 4.95.

### Changes

1. **Retune `WIND_BANDS` thresholds** in `src/cyclist/windCategory.ts` to `1.2 / 2.4 / 3.6 / 5.0 /
   7.0`. Keep the six labels and the blurbs; they still describe the right experiences, they were
   just attached to the wrong numbers.
2. **These are rider-height thresholds now.** Say so in a comment, with the median and p90 above, so
   the next person does not "correct" them back to met-station values.
3. **Retire the red/green semantic pair** in `src/components/ui.ts`:
   `good: "#1f9d57"` → `"#2e7488"` (teal), `bad: "#e0533d"` → `"#b0522e"` (rust).
   This pair carries the tailwind/headwind distinction, which is the most important signal in the
   app, using the one colour pair ~8% of men cannot separate — in a cycling app for a cycling city.
4. **Rotate the six-stop map ramp** away from teal → green → amber → orange → magenta. Green → amber
   → orange is three steps that collapse to one under deuteranopia, and they are the three middle
   bands that now carry 74% of the map. Load the `dataviz` skill before choosing replacements.
5. **Update `ROUTE_IMPACTS`** to match, so the panel and the map agree on what a headwind looks like.

### Acceptance

```
band occupancy over Weibull(2, 6.1) ambient x lambda 0.34 x uniform orientation:
  no band below 1% or above 40%

deuteranopia simulation of the six ramp stops: every adjacent pair stays distinguishable

existing windCategory tests updated to the new thresholds, with the old values
noted in a comment as the pre-step-2a calibration
```

Take a before and after screenshot of the same Nørrebro view. The map should regain visible
structure — right now it reads as two colours.

## Step 3b — Correct the map ramp (follow-on from step 3)

Step 3 landed as `2c73ef3` on `fix/wind-scale-calibration`. The thresholds and the diverging panel
scale are **correct and should stay**. The map ramp has two measured defects.

The agent replaced the six-hue map ramp with a single-hue rust sequential ramp. That principle is
right — wind strength is ordered magnitude, so order belongs in lightness, and the old ramp was not
even monotonic (Moderate OKLab L 0.764 against Calm 0.638). Keep the principle. Fix the hue and the
light end.

**1. Contrast.** Arrows are ~8 px glyphs on white roads (`#ffffff`) over warm land (`#f2ede2`).
WCAG 1.4.11 requires 3:1 for graphical objects.

| band | current | vs white road |
|---|---|---|
| Calm | `#ccab98` | **2.13:1** |
| Light | `#c3896a` | **2.95:1** |

Those two bands are 48.2% of the map. Roughly half the arrows sit below the floor.

**2. Semantic collision.** The map ramp encodes magnitude; `ROUTE_IMPACTS` encodes direction. They
are now the same colours:

| panel | map | ΔE |
|---|---|---|
| Headwind `#b66947` | Moderate `#b76740` | **0.8** |
| Strong headwind `#9f431d` | Strong `#a34820` | **1.4** |

A rust arrow on the map does not mean headwind. Both meanings appear on screen together.

### Change

Keep `ROUTE_IMPACTS` exactly as committed — the diverging teal ↔ rust about a light neutral is
correct. Move the **map** ramp to indigo, which avoids water (teal), parks (green) and the panel's
rust:

```
Calm         [130, 142, 202]   #828eca   3.15:1
Light        [106, 118, 185]   #6a76b9   4.28:1
Moderate     [ 83,  94, 168]   #535ea8   5.94:1
Strong       [ 62,  70, 150]   #3e4696   8.33:1
Very strong  [ 43,  45, 133]   #2b2d85  11.56:1
Severe       [ 27,  15, 115]   #1b0f73  15.41:1
```

Monotonic lightness, adjacent ΔE 7.7, min ΔE to panel rust **19.1** (was 0.8).

### Acceptance

```
every WIND_BANDS colour >= 3.0:1 against #ffffff        // WCAG 1.4.11, arrows are graphics
min OKLab dE from any WIND_BANDS colour to any
  ROUTE_IMPACTS headwind colour >= 12                   // magnitude must not read as direction
WIND_BANDS OKLab lightness strictly decreasing
adjacent WIND_BANDS dE >= 7
```

Pin these as tests. They are the gates the first pass missed, and they are cheap to check.

### Completed 2026-09-03 — commits `2c73ef3` (step 3) and `393ee24` (step 3b)

Thresholds 1.2 / 2.4 / 3.6 / 5.0 / 7.0. Map ramp indigo, panel scale diverging teal ↔ rust.
`npm run check` green: **92 tests** (was 81 before step 3). All four gates pinned as tests with
WCAG contrast and OKLab ΔE implemented in the test file, no outside tooling.

Both gates confirmed failing on the rust ramp before the change: Calm 2.13:1, and map Moderate vs
panel Headwind ΔE 0.8.

Independently re-verified under Viénot deuteranope simulation — the number that actually matters for
a sequential ramp is whether lightness order survives, not adjacent ΔE:

| ramp | deutan adjacent ΔE | lightness monotonic under deutan | L span |
|---|---|---|---|
| rust | min 8.3 | yes | 0.415 |
| **indigo (shipped)** | min 7.7 | **yes** | 0.382 |

Indigo gives up 8% of lightness span and buys 48% of the map clearing the 3:1 visibility floor plus
the removal of the magnitude/direction colour collision. Correct trade.

**Root cause of the step 3 defects, worth remembering:** each scale was validated in isolation and
never measured against the other, or against the surface it lands on. The ΔE ≥ 12 cross-palette gate
now enforces the first automatically and the 3:1 gate the second.

**Left over for step 4:** the comment above `ROUTE_IMPACTS` still says the scale matches `ui.ts`
"so the panel and the map agree on what a headwind looks like". After 3b that reads backwards — the
map now deliberately shares no colours with the panel. One line, fix it when that block is next open.

---

## Step 3c — Colour the map by shelter, not absolute speed

Chosen by the user 2026-09-03 after seeing step 3b live. **The palette is fine; the thresholds
answer the wrong question.**

### Why

Step 3's bands were calibrated against Copenhagen's year-round wind distribution. The map never
shows a year — it shows one ambient at a time, where the only variables are street orientation and
canyon depth. Measured on the real 5,110-segment central network, that spread is **fixed at 2.83×
regardless of wind speed**:

| ambient | p5 | median | p95 | spread | bands on screen |
|---|---|---|---|---|---|
| 2.0 m/s | 0.50 | 1.16 | 1.43 | 2.83× | 2 |
| 4.4 m/s | 1.11 | 2.56 | 3.15 | 2.83× | 3 |
| 7.0 m/s | 1.77 | 4.08 | 5.00 | 2.83× | 4 |
| 11.0 m/s | 2.77 | 6.40 | 7.86 | 2.83× | 5 |

At the live 4.4 m/s, 92.2% of arrows fell in two adjacent bands. The map correctly showed one
colour.

The ratio `streetSpeed / ambientSpeed` has the same distribution every day, because geometry fixes
it: p5 0.252, median 0.582, p95 0.715, identical at 2 m/s and 11 m/s. **A scale over ratio uses its
full range daily.**

The map answers "which streets are sheltered". The header already answers "how windy is it", and
`cyclist/advisory.ts` already carries absolute hazard as its own chip, so no safety signal depends
on arrow colour.

### The 0.60 reference

`0.60` is an open street — `URBAN_BL_CORRECTION` with no canyon. **16.2% of central segments sit
exactly there** (the λ < 0.1 early return). Below 0.60 the canyon blocks wind; above it, the canyon
channels wind along the street. That is the physical story the app has always claimed and never
shown. Cuts must not split the 0.60 mode.

### Changes — `src/cyclist/windCategory.ts`

1. Add `shelterRatio(streetSpeedMs, ambientSpeedMs)`. Guard `ambientSpeedMs < 0.1` by returning
   `0.60` (the open-street reference) rather than dividing by ~zero.
2. `windBand()` and `windBandColor()` take the **ratio**, not a speed. Rename the type's numeric
   bounds accordingly — they are no longer m/s.
3. Cuts `0.35 / 0.48 / 0.58 / 0.63 / 0.70`, measured against the real network pooled over 24 wind
   directions:

| band | ratio | share | blurb |
|---|---|---|---|
| Deeply sheltered | < 0.35 | 13.2% | Buildings block almost all of today's wind. |
| Sheltered | 0.35–0.48 | 19.5% | Well shielded; you will barely feel it. |
| Partly sheltered | 0.48–0.58 | 18.0% | Some shelter from the buildings. |
| Open | 0.58–0.63 | 29.1% | About the open-air wind at street level. |
| Channelled | 0.63–0.70 | 14.8% | The street funnels wind along its axis. |
| Strongly channelled | > 0.70 | 5.4% | Buildings accelerate the wind down this street. |

4. **Keep the indigo colours exactly as committed in 3b.** They are validated and unchanged.
5. `ROUTE_IMPACTS` unchanged — it is signed along-route m/s and stays absolute.

### Consumers — all three must be updated

| file | line | change |
|---|---|---|
| `layers/buildWindArrows.ts` | 128 | `windBandColor(shelterRatio(lane.speedMs, wind.speedMs))` — `wind` is already in scope at line 114 |
| `components/SegmentTooltip.tsx` | 58 | needs a **new prop** `ambientSpeedMs: number`, passed from `App.tsx`. Show both: the absolute `modifiedSpeedMs` in m/s *and* the shelter band. The tooltip is where absolute strength belongs. |
| `components/Legend.tsx` | 23, 43 | the legend is now meaningless without the reference. Head it `Shelter · relative to N.N m/s now`, so it needs the ambient too. |

Fix the stale comment above `ROUTE_IMPACTS` while you are in the file (see step 3b notes).

### Acceptance

```
scale invariance:
  windBand(shelterRatio(2.64, 4.4)) === windBand(shelterRatio(6.0, 10.0))   // both 0.60

open-street reference:
  shelterRatio(0.6*A, A) lands in the "Open" band for every A in [1..15]

zero guard:
  shelterRatio(0, 0) does not throw, returns 0.60

occupancy on the REAL network (public/data/segtiles, 24 wind directions):
  no band below 4% or above 35%
```

Pin the occupancy test against the shipped tile data, not a synthetic distribution. That is what
went wrong the first time.

### Expect

The map should show four to six distinct indigo shades in one view at any wind speed, and the
pattern should be legible as structure: sheltered courtyard streets pale, wind-aligned arterials
dark. Screenshot before and after at the same Nørrebro view.

### Completed 2026-09-03 — commit `94f2744`

Cuts `0.35 / 0.50 / 0.595 / 0.605 / 0.66`. Occupancy on the real shipped network
9.7 / 21.7 / 17.7 / 26.6 / 15.4 / 9.0. 97 tests green (was 92). Build clean.
`ROUTE_IMPACTS`, `ui.ts`, `src/math/` and `src/routing/` untouched.

**Two corrections to this spec, both mine.**

1. **The "5,110-segment central network" it was calibrated against does not exist.** That was six
   tiles I happened to have staged, not a repo artefact. The shipped network is 59,750 segments and
   nothing defines "central". Dense inner-city tiles carry more canyons than the suburbs, so the
   subsample understated the no-canyon population: **16.2% at exactly 0.600 in my six tiles against
   24.2% across the real network**. My cuts consequently put Open at 37.8%, over this spec's own
   35% gate. The agent measured it, refused to guess, and escalated. Correct call.
   **Calibrate against every shipped tile, never a convenience sample.**

2. **There were four consumers, not three.** `layers/FlowLineLayer.ts:100` also colours by band and
   was missing from the table above. A ratio and a speed are both `number`, so TypeScript would
   have accepted the mistake in silence and every flow line above 0.7 m/s would have drawn as
   "strongly channelled" — plausible-looking and wrong. Both layers now pass a ratio.

### Follow-on for step 4 — the "Open" band is telling two stories

Measured on the shipped tiles, of everything landing in the Open band (λ < 0.1):

| geometrySource | share of the Open band |
|---|---|
| `measured` | 0.7% |
| `partial` | 6.4% |
| **`fallback`** | **92.9%** |

`fallback` means the perpendicular ray-cast found no building and the 25 m centroid guess was used.
So "Open · about the open-air wind at street level" currently means both *this street genuinely has
no canyon* and *we could not measure this street*, across roughly a quarter of the map.

`geometrySource` is already on every segment and already reaches `SegmentTooltip`. Either split the
band, or have the tooltip say plainly when the geometry was guessed. This was invisible while the
scale was absolute; the shelter framing surfaced it.

---

## Step 4 — Rebuild `RoutePanel.tsx`

Panel only. Map work moved to step 5. Steps 1–3c are done, so the numbers this renders are final.
Same data as today, **22 numbers down to 7**.

**Do not invent copy or layout.** Every string and every measurement below is specified. Where this
spec gives a number, use that number. Where it gives a sentence, use that sentence verbatim —
these were written against a rendered mockup you cannot see, and paraphrasing them will lose the
thing they were tuned for. If something here is impossible or contradictory, stop and say so rather
than substituting your own judgement.

### Make the copy testable

Layout cannot be unit-tested and should not be faked. The *decisions* can be. Extract them as pure
functions in `src/cyclist/` with tests, so the component holds only markup:

```ts
formatWindDelta(seconds: number): string
verdictFor(opts: RouteOption[], windIsSimilar: boolean, best: BestWindow | null): string
```

That is the line: anything that chooses a word or a number gets a test; anything that positions a
pixel gets a screenshot.

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
- **A verdict sentence** below the list, driven by `windIsSimilar` and `bestRideWindow()`
  (both already shipped). Use these three strings exactly:
  - `windIsSimilar === false` → *"The short way costs you an extra 1 min 47 s today. Go round."*
  - `windIsSimilar === true` and `bestRideWindow()` returns null →
    *"Wind costs about 35 s whichever way you go today. Take the short one."*
  - `windIsSimilar === true` and `bestRideWindow()` returns a window →
    *"Wind costs about 35 s whichever way you go. Leave at 16:00 and it costs nothing."*

  That third case is the important one. **When wind does not
  discriminate between routes it often still discriminates between hours**, and on a 1.4 km trip
  where every route costs the same, *when to leave* is the better answer than *which way to go*.
  `bestRideWindow()` already computes it, with a conservative 1.2-unit improvement threshold so it
  stays quiet unless the gain is real. Wire it into the verdict rather than writing anything new.

  The `TimeSlider` also means route metrics are no longer a function of current wind alone. Take the
  wind for the selected forecast hour, not `useCurrentWind()`, and label the panel when the selected
  hour is not "now".
- **A footer line**, two quiet text controls, 12 px, muted, 16 px apart:
  `Sort by wind` and `Commuter bike, 18 km/h`. The second is inert until step 6 — render it, do not
  wire it.

### `formatWindDelta` — exact strings

| input | output |
|---|---|
| `+35` | `+35 s into the wind` |
| `+107` | `+1 min 47 s into the wind` |
| `-40` | `−40 s with the wind` (U+2212 minus, not a hyphen) |
| `\|x\| < 5` | `no wind either way` |

### Layout — exact values

```
sheet padding            18px 18px 16px
waypoint row             13.5px, dot 7px, gap 10px, padding 5px 0
rule under waypoints     1px var(--line), margin 14px 0

route row                padding 13px 0, border-bottom 1px var(--hairline)
                         last row: no border
  time                   24px / 600 / letter-spacing -0.025em / line-height 1
  distance               13px, COLORS.faint, right-aligned, baseline-aligned with time
  wind delta             12.5px, COLORS.dim, margin-top 5px, beneath the time
  first row time         COLORS.accent — that is the only colour in the list

verdict                  13.5px / line-height 1.5, margin-top 14px,
                         padding-top 13px, border-top 1px var(--line)
footer                   12px, COLORS.faint, gap 16px, margin-top 14px
```

`font-variant-numeric: tabular-nums` (the `NUM` object in `ui.ts`) on every number.

### Surface

Make the route sheet **opaque**. `glass` is `rgba(255,255,255,0.72)` with a 20 px backdrop blur, so
street labels and building fills currently show through body text. Outdoors on a phone that is a
legibility problem before it is an aesthetic one. Keep `glass` on the small floating wind chip,
where nothing has to be read at length.

Keep Inter. The typeface is the least important part of this change.

### Screenshot checkpoint

Stop after the component builds and `npm run check` passes. Do not proceed to polish. The user
takes phone screenshots of three states — no route, calm day (`windIsSimilar` true), and a state
where wind discriminates — and those decide whether it is done.

### Completed 2026-09-03 — commit `434b1de`, branch `feat/route-panel-redesign`

Copy decisions extracted to `routeCopy.ts` with 14 tests covering every row of both spec tables.
111 tests green (was 97). Lint and build clean. Component holds only markup.

---

## Step 4b — Three fixes the spec caused

**Two of these are spec errors, not implementation errors.** The agent built what was written and
flagged both rather than inventing around them. That was correct.

**1. The waypoint rows lost their affordance.** The spec gave measurements
(13.5 px, 7 px dot, 10 px gap, `5px 0` padding) taken from the mockup — where those rows *displayed*
already-chosen waypoints. In the real app they are `LocationSearch` inputs. Unboxed, they no longer
read as tappable.

Restore the affordance without restoring the box: keep the type and spacing exactly as built, and
add a **1 px `var(--line)` bottom border on each waypoint row**, with `padding-bottom` raised from
5 px to 8 px. A hairline underline says "field" without reintroducing a container. The existing rule
between the waypoints and the route list then becomes redundant — remove it, the two underlines do
that job.

**2. Selection has no visual state.** The spec removed every per-row treatment and then spent the
only remaining colour on rank. But **order already carries rank** — that was the argument for
deleting the star. So the accent has no job.

Move it: **the accent marks the selected row, not the first row.** Default the selection to
`bestId` on load, so the initial render is unchanged. Clicking a row moves the accent to it. No new
visual vocabulary, and selection becomes visible for free.

**3. The forecast-hour label.** The spec asked for it and gave no string and no slot, so it was
correctly left undone. Both, now:

- **Slot:** a line directly above the route list, 12 px, `COLORS.dim`, `margin-bottom 10px`.
- **String:** `Times below use the 16:00 forecast.` — hour formatted as `HH:mm`, same formatter the
  `TimeSlider` uses.
- **Condition:** render only when the selected forecast hour is not the current hour. Nothing when
  it is.

Add it to `routeCopy.ts` as `forecastNote(selectedHour: Date | null, now: Date): string | null` and
test the null case.

### Acceptance

`npm run check` and `npm run build`. Then the same three screenshots step 4 asked for, which have
not been taken yet.

### Completed 2026-09-03 — commits `434b1de` (step 4) and `aae4d0c` (step 4b)

Branch `feat/route-panel-redesign`, rebased onto the bot's `cfea00e`. **116 tests** green (was 97).
Lint and build clean. Copy decisions live in `routeCopy.ts` — `formatWindDelta`, `verdictFor`,
`forecastNote` — with 19 tests between them covering every string in this spec.

Both step 4b spec errors were mine and were flagged rather than worked around: waypoint measurements
taken from a mockup where those rows displayed chosen waypoints rather than being inputs, and the
accent spent on rank when order already carries rank.

**Verification method, settled:** push the branch, screenshot the Vercel preview. No local dev
server. Four steps were spent trying to render locally before anyone said this out loud —
`CLAUDE.md` now says it.

**Still unverified visually** — three states, and they are the only open item on step 4:

1. no route yet (panel says nothing)
2. `windIsSimilar === true` — the calm-day verdict
3. wind discriminating — the "go round" verdict

Watch specifically for the two things the spec got wrong once already: whether the underlined
waypoint rows read as tappable fields, and whether the accent on the selected row is visible enough
to serve as selection state.

---

## Step 5 — Map legibility and honesty

Three things step 3c left behind, all map-side. Small, and they travel together because they touch
the same two files.

**1. Glyph legibility.** Adjacent bands are ΔE 7.7 apart, which reads clearly in a 20 px legend
swatch and marginally on a small anti-aliased arrow over a light basemap. The palette is finished;
the remaining lever is size.

`FlowLineLayer.sizeForSpeed()` is `clamp(2.6 + 0.95·v, 3, 9.5)`. After step 3c the realistic
street-level speeds are roughly 0.25× to 0.72× ambient, which compresses the whole map into a
narrow band of sizes:

| ambient | street p10 → p90 | current size | proposed size |
|---|---|---|---|
| 2.0 m/s | 0.50 → 1.44 | 3.1 – 4.0 px | 4.0 – 5.4 px |
| 4.4 m/s | 1.10 → 3.17 | 3.6 – 5.6 px | 4.9 – 8.0 px |
| 7.0 m/s | 1.75 → 5.04 | 4.3 – 7.4 px | 5.8 – 10.8 px |
| 11.0 m/s | 2.75 → 7.92 | 5.2 – 9.5 px | 7.3 – 14.0 px |

The 3 px floor swallows everything under 0.42 m/s, so six colour bands are being drawn across about
three pixels of size difference. **Change to `clamp(3.2 + 1.5·v, 4, 14)`**, which roughly doubles
the usable spread.

**This number is a first guess and needs eyes.** It is derived from the speed distribution, not from
looking at the map — the one thing in this plan that cannot be. Expect a second pass after
screenshots. Say so in your report rather than treating it as settled.

**Do not touch density or decimation** without reporting first. Check whether any zoom-dependent
thinning exists and say what you found; if there is none, that is a finding for a later step, not
something to invent now.

**2. Make the dual encoding deliberate.** After 3c the map encodes *shelter* in colour and *absolute
strength* in size. That is the right pair and it happened by accident. Write it down in a comment in
`FlowLineLayer.ts` so nobody "fixes" the size function to use the ratio too and collapses the two
channels into one.

**3. The `Open` band is telling two stories.** Measured on the shipped tiles, of everything in the
Open band (λ < 0.1): `measured` 0.7%, `partial` 6.4%, **`fallback` 92.9%**. So "About the open-air
wind at street level" also means "we could not measure this street", across roughly a quarter of the
map. `geometrySource` is already on every segment and already reaches `SegmentTooltip`. Say it in
the tooltip — one line, something like *"No building data here — treated as open."* Do not split the
band; the colour is right, the claim just needs a caveat where it is guessed.

Also fix the stale comment above `ROUTE_IMPACTS` while in `windCategory.ts`: it still says the scale
matches `ui.ts` "so the panel and the map agree on what a headwind looks like", which 3b deliberately
reversed.


### Completed 2026-09-03 — commit `c5436b1`

Branch `fix/map-legibility`. **It was branched from `feat/route-panel-redesign`, not from `main`**,
so it carries steps 4 and 4b as well as step 5 (the panel commits reappear as `b905fbf`/`630ebc6`
after the rebase onto the bot's `818b0aa`). Verified 2026-09-04 by test-merging into `main`: clean,
and the only source difference from the panel branch is step 5's three files. **One PR from
`fix/map-legibility` lands everything; `feat/route-panel-redesign` can be deleted after.** The
earlier note here saying "branched from `main`" was wrong.

**116 tests** green, lint and build clean — re-run independently 2026-09-04, same result.
`sizeForSpeed()` is now `clamp(3.2 + 1.5·v, 4, 14)`. The dual encoding is written down in
`FlowLineLayer.ts`. `SegmentTooltip` carries the `fallback` caveat.

**Item 4 was already done.** The stale `ROUTE_IMPACTS` comment was removed in step 3c; the commit
only re-wrapped a ragged line there.

### Reviewed 2026-09-04 — the map was rendered headless, and item 1 did nothing below zoom 17

The app was built and screenshotted in a headless Chromium (no basemap — that host is unreachable
from the sandbox — but arrows, buildings and the panel all draw from local data). Two things the
spec got wrong, both mine:

**`sizeForSpeed()` returns metres, not pixels.** `createFlowLineLayer` sets `sizeUnits: 'meters'`
with `sizeMinPixels: 6` (8 on phones) and `sizeMaxPixels: 28`. The whole step 5 table above is
labelled "px" and is wrong. deck.gl and MapLibre define zoom on 512 px tiles, so at Copenhagen's
latitude one pixel is 5.4 m at zoom 13, 0.67 m at 16, 0.34 m at 17 (a first draft of this
paragraph used the 256 px convention and had every figure twice too large — corrected 2026-09-04).
Rendered size on a 4.4 m/s day (street p10 = 1.1 m/s, p90 = 3.17 m/s):

| zoom | m/px | before step 5 | after step 5 |
|---|---|---|---|
| 13 – 15 | 5.4 – 1.35 | 6.0 – 6.0 px | 6.0 – 6.0 px |
| 16 | 0.67 | 6.0 – 8.3 px | 7.2 – 11.8 px |
| 17 | 0.34 | 10.8 – 16.7 px | 14.4 – 23.6 px |
| 18 | 0.17 | 21.7 – 28 px | 28 – 28 px (cap) |

Every arrow from zoom 13 to 15 sits on the 6 px floor, before and after; at 16 the channel was
marginal before and step 5 opened it; at 18 step 5 pushed everything onto the 28 px cap. Below
zoom 16 the size channel is dead, and a 6 px anti-aliased arrow is where the ΔE 7.7 band
separation stops reading. The screenshots show exactly that: specks at 13.5 and 15.5, readable
arrows only at 17.5.

**`arrowDensityForZoom` is only half wired.** `App.tsx` consumes `'hidden'` and nothing else;
`'single'` and `'multi'` are computed and ignored, and `buildFlowField` always emits
`ARROWS_PER_STREET = 3`. So at zoom 13.5 the 40 m spread is 5 px wide and three arrows draw on top
of each other per street. The step 5 report's description of the density function was read from the
function, not from its caller.

Two smaller things the render showed, listed under 5b and 4c below: the forecast strip wraps its
header at two-digit speeds, and the route panel's forecast note fires while the slider is still on
"Now" for the second half of every hour.

**Rendered and judged, so no longer a guess:** the size range and density rule in step 5b were
tried on the same build and screenshotted at zoom 13.5, 15.5, 16.5 and 17.5, on a 4.4 m/s day and
an 11 m/s day, desktop and a 390 px phone viewport. They read as a wind field at every zoom.
DJ's screenshots on the real basemap are still wanted, but for taste, not for whether it works.

---

## Step 5b — Size arrows in pixels; finish the density rule

Branch `fix/map-legibility`, on top of `c5436b1`. Two files: `src/layers/FlowLineLayer.ts` and
`src/App.tsx`. Plus one chip fix and one deletion.

**1. Pixel units.** A data glyph should encode the same value the same way at every zoom; only
metre-sized glyphs need a zoom-dependent clamp, and that clamp is what killed the channel. In
`createFlowLineLayer`: `sizeUnits: 'pixels'`, delete `sizeMinPixels` and `sizeMaxPixels`. In
`sizeForSpeed`:

```ts
// Pixels. 8 px is the smallest size at which the arrowhead still resolves on a
// light ground; 22 px is where arrows start to overlap at 'multi' density.
function sizeForSpeed(speedMs: number): number {
  return Math.max(8, Math.min(22, 8 + speedMs * 2.2));
}
```

and `getSize: (d) => d.sizePx + (isMobile ? 2 : 0)` — phones are held further from the eye and
the arrow is a touch target. Rename `sizeM` to `sizePx` everywhere it appears (the `FlowLine`
field, its doc comment, `buildFlowField`, `getSize`). Rewrite the comment block above
`sizeForSpeed` to say pixels; its second paragraph currently talks about "three pixels of size
difference" against a metre formula, which is the confusion that produced this step.

Rendered sizes: 1.1 m/s → 10.4 px, 3.17 → 15.0, 5 → 19, ≥ 6.4 → 22. On a 4.4 m/s day p10 and p90
differ by 44 %; on an 11 m/s day the map is visibly bolder. Both were looked at.

**2. Wire the density.** `buildFlowField(segments, wind, arrowsPerStreet = ARROWS_PER_STREET)`,
and in `App.tsx` the call becomes `buildFlowField(visible, activeWind, density === "single" ? 1 : 3)`.
`density` is already in that `useMemo`'s dependency list.

At one arrow per street there is no neighbour to mask the conveyor's wrap-around fade, so with the
existing `FADE = 0.18` a third of the field is half-transparent at any instant — rendered, and it
reads as arrows randomly missing. So at `'single'` density the field is **static**: `travelLenM = 0`
and `arrowAlpha` returns 1 when `d.travelLenM === 0`. The animation becomes a zoom-16-and-up
feature; a static field was rendered at 13.5 and 15.5 and read well at both. This also cuts the
per-frame CPU work by two thirds below zoom 16; leave the 650 / 1700 street cap where it is —
visual density at 13.5 was judged right with one arrow per street.

Add to `FlowLineLayer.test.ts` (create it if absent): `buildFlowField` with `arrowsPerStreet = 1`
emits one entry per segment with `travelLenM === 0`; with 3, three entries with `phase` 0, ⅓, ⅔.

**3. The forecast strip header wraps.** `TimeSlider.tsx` line ~64: at "11.0 m/s · gust 16 · 15°"
the label "Wind forecast" breaks onto two lines and "m/s" drops under the number. Every `<span>` in
that header row gets `whiteSpace: "nowrap"`; the value group gets `flexShrink: 0`; the label gets
`flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis"`. Data never wraps or
clips; the label yields first. Widen the desktop strip from 320 to 340 px.

**4. Delete the dead arrow layer.** `src/layers/WindFlowLayer.ts` is not imported anywhere, and
`buildWindArrows.ts` is imported by the app only for `arrowDensityForZoom` and the `RawSegment`
type. Delete `WindFlowLayer.ts`; in `buildWindArrows.ts` keep `RawSegment`, `ArrowDensity` and
`arrowDensityForZoom`, delete the rest. `grep -rn` for every deleted export before committing; if
anything in `src/` other than a test imports one, stop and report.

`src/layers/buildWindArrows.test.ts` tests the dead `buildWindArrows()` and goes with it — **this
is the one case where a test is deleted rather than obeyed**, because the code it pins is not
called. Port its second case, "arrows point in the true wind vector, not the street axis", to
`FlowLineLayer.test.ts` against `buildFlowField` (an open street at bearing 30 under a crosswind
must have `flowDeg` more than 30° off the street axis). Its first case, carriageway confinement,
tests lane geometry `FlowLineLayer` does not have; drop it. Two arrow layers with two size
functions in two units is how step 5 went wrong.

### Acceptance

`npm run check`, `npm run build`. Then the three step 5 screenshots on the Vercel preview, taken by
a human: zoom 13, 16, 17. What is being judged is taste — too dense, too bold — not whether the
encoding works, which has been seen.

One thing the headless render could not judge, because it had no basemap: the palest band,
`deeply_sheltered` (130, 142, 202), measures 2.7 : 1 against the app's cream ground and 3.1 : 1
against Positron's white streets — at and below the WCAG 3 : 1 line for graphical objects. If those
arrows vanish on the real map, the fix is a darker top of the ramp with the ΔE gate in
`windCategory.test.ts` re-run, as its own step. Not before it has been seen.


### Completed 2026-09-04 — commit `4a73847`

Pixel units, density wired, static single-arrow field, chip header fixed, dead layer deleted.
Reviewed against the branch and re-run here: green. Superseded a few hours later by step 5c —
DJ's screenshots of it showed the remaining problem, which is placement, not size.

---

## Step 4c — The verdict is wrong on tailwind days, and the forecast note fires on "Now"

Both found by rendering the panel with fixture winds. Both are spec errors from step 4; the
implementation did what the spec said.

**1. The forecast note.** `forecastNote()` compares the selected step's hour with the current hour.
But `fetchCurrentWind` drops any step older than 30 minutes, so from :30 onward `forecast[0]` is the
*next* hour and the note says "Times below use the 13:00 forecast." while the slider sits on "Now".
It also renders with no routes under it. The rider's question is "did I scrub?", so ask that:

- `App.tsx`: `forecastNote(step, now)` becomes `forecastIdx > 0 ? forecastNote(step) : null`.
  `forecastNote(selectedHour: Date | null): string | null` loses its `now` argument and the
  hour comparison. Keep the null-for-invalid-date case.
- `RoutePanel.tsx`: render the note only when `options.length > 0`. It says "Times below".
- Tests: update the `forecastNote` cases to the one-argument signature. The `forecastIdx === 0`
  gate lives in `App.tsx`, which has no test harness — say so in the report rather than inventing
  one.

**2. The verdict.** Rendered on a 9 m/s WNW day riding Nørreport → Islands Brygge, every route
saves 1 – 1½ min *with* the wind, and the panel said *"Wind costs about 0 s whichever way you go
today. Take the short one."* — and, with a lighter hour ahead, *"Leave at 16:00 and it costs
nothing."* Leaving later would lose the tailwind. Two causes: `verdictFor` floors the mean delta at
zero because the spec's sentence said "costs"; and the "Leave at" clause never prices the route at
that hour — `bestRideWindow()` scores wind + rain discomfort, so it can fire on "less rain" with
identical wind.

Also: `opts[0]` is whatever the *displayed* sort put first. With "Sort by wind" on, the verdict
compares the shortest route against the least-windy one and can fall into the calm-day sentence on
a windy day. The verdict is a statement about the day, not about the sort.

Replace `verdictFor` with this decision table. `opts` is `rankRoutes(options, 'recommended').sorted`
— `App.tsx` computes that once regardless of `criterion` and passes it as a separate prop
`recommendedOrder`. `rec = opts[0]`, `shortest` = min `distanceM`, `mean` = mean `windDeltaS`,
`extraS = shortest.timeS − rec.timeS`. `NEGLIGIBLE_S = 5` as now.

| case | condition | sentence |
|---|---|---|
| A | `opts.length === 0` | `""` |
| B | `!windIsSimilar && opts.length > 1 && extraS >= 1` | `The short way costs you an extra {extraS} today. Go round.` |
| C | `!windIsSimilar` otherwise, `mean > NEGLIGIBLE_S` | `The short way is still the fastest today.` |
| D | `windIsSimilar`, `mean > NEGLIGIBLE_S` | `Wind costs about {mean} whichever way you go today. Take the short one.` |
| E | `mean < −NEGLIGIBLE_S` (any spread) | `The wind is with you today. Take the short one.` |
| F | `abs(mean) ≤ NEGLIGIBLE_S` | `No wind to speak of today. Take the short one.` |

Row order is precedence: B before E, so a tailwind day where a detour is still faster gets "Go
round". C and E and F never say "costs".

**The "Leave at" clause** attaches to C and D only — the two headwind rows — and only after
re-pricing. In `App.tsx`, when `rideWindow` is set, compute
`routeMetrics(rec.path, forecast[rideWindow.index].wind, DEFAULT_PARAMS).windDeltaS` on the main
thread (`routeMetrics` is pure and `path` is plain data posted back from the routing worker) and
pass `bestWindow = { at, deltaS }`. Then in `verdictFor`, with `deltaS` the re-priced cost:

- `deltaS < NEGLIGIBLE_S` → clause `Leave at {at} and it costs nothing.`
- `mean − deltaS >= 10` → clause `Leave at {at} and it costs about {deltaS}.`
- otherwise no clause.

For D the clause replaces "today. Take the short one."; for C it is appended after the sentence.
So: *"Wind costs about 47 s whichever way you go. Leave at 16:00 and it costs about 12 s."* and
*"The short way is still the fastest today. Leave at 16:00 and it costs nothing."*

Tests in `routeCopy.test.ts`: one per row A–F and one per clause outcome, each built from a small
fixture of two or three `RouteOption`s with hand-set `metrics`. `BestWindow` gains `deltaS: number`.
Keep the existing `formatWindDelta` cases untouched.

**3. "Sort by wind" with nothing to sort.** Render that control only when `options.length > 1`.
The bike label stays — step 6 turns it into the picker.

### Acceptance

`npm run check`, `npm run build`. Screenshots on the preview: the empty panel (no note, no sort
control), a route with the slider scrubbed one hour ahead (note present), and — if the day
allows — a tailwind verdict.


### Completed 2026-09-04 — commit `c054a8c`

Diff read line by line against the table above: rows A–F and the clause rules are implemented as
written, `recommendedOrder` is computed once in `App.tsx` and is what the verdict reads,
`bestWindow.deltaS` comes from `routeMetrics()` on the main thread, the forecast note is gated on
`forecastIdx > 0` and on `options.length > 0`, and "Sort by wind" hides below two routes. Lint,
tests and build green with the step 5c patch applied on top (127 tests).

---

## Step 5c — One arrow per screen cell: the lattice

DJ's screenshots of step 5b on the real basemap, 2026-09-04: arrows pile up at junctions and
bends and thin out on long straights. One cause — three arrows per road segment whatever its
length, so a 6 m stub at a junction gets the same three as a 40 m straight, and parallel OSM
cycleways add three more. DJ's brief, verbatim: *constant spacing and density, organised,
structured, side by side; smaller arrows if needed.* The reference he sent is a regular grid.

**This step was built and rendered before it was written.** The patch at the repo root,
`step5c.patch`, is the implementation that produced the renders described below; it applies
cleanly on `c054a8c` and passes `npm run check` (127 tests) and `npm run build` there. The job in
auto mode is to apply it, verify, and commit — not to re-derive it.

```
git apply --3way step5c.patch
rm step5c.patch
npm run check && npm run build
git add -A && git commit
```

`--3way` applies against the committed blobs, so the CRLF working tree on Windows does not
matter. If it reports conflicts, `git checkout -- .`, stop and report; do not hand-merge.

### What it does

**Placement.** `buildFlowField(segments, wind, { spacingM, onRoad })` in `FlowLineLayer.ts`.
Every segment offers candidate points every half `spacingM` along its axis (at least its centre).
Candidates are binned into square cells `spacingM` wide in local metres, and the candidate nearest
each cell's centre wins. One rule, two regimes: zoomed out, cells are larger than segments and the
field thins to one arrow per cell; zoomed in, cells are smaller than segments and arrows run along
each road one cell apart. Junctions and parallel cycleways share cells, so they never pile up. The
count is bounded by the cells in view — about 800 on a desktop, 200 on a phone — so the 650 / 1700
street cap and its index stride are deleted.

`spacingM = ARROW_SPACING_PX × metres-per-pixel`, `ARROW_SPACING_PX = 40`, computed in `App.tsx`
from the zoom quantised to quarter levels (`zoomQ`), with the 512 px tile constant:
`78271.517 × cos(lat) / 2^zoom`.

**Lattice below zoom 16, road above.** `onRoad = density === "multi"`. Below 16 the arrow is drawn
at its cell centre — a true grid, rows and columns, as in the reference — carrying the wind of the
nearest street (never more than half a cell away, 27 m at zoom 15). From 16 up the arrow sits on
the road it stands for, because buildings are drawn and an arrow on a roof would be a lie.

**Nothing moves.** The drift-and-fade conveyor is gone: `boundedTravel`, `travelLenM`, `FADE`,
`fracOf`, `arrowPosition(d, time)` all deleted, and `getPosition` drops out of `updateTriggers`.
Direction is animated as a brightness wave travelling downwind through the lattice:
`alpha = 0.7 + 0.3 · (0.5 + 0.5 · sin(2π (phase − t · RATE)))`, where `phase` is the arrow's
position along the ambient wind vector in wavelengths (`WAVELENGTH_CELLS = 6`), `RATE = 0.25`
cycles/s. No arrow is ever fainter than 0.7, so none "goes missing" in a still frame — the fade
was what made the 5b field look gap-toothed.

**Size.** `clamp(10 + 1.6·v, 10, 18)` px, plus 2 on phones. 18 px is under half the 40 px pitch, so
neighbours never touch whatever way the wind blows. 1.1 m/s → 11.8 px, 3.17 → 15.1, ≥ 5 → 18.

**Tests** (`FlowLineLayer.test.ts`, replacing the 5b density cases): a 200 m street on a 40 m
pitch yields 5 or 6 arrows one pitch apart; two parallel streets 8 m apart draw once; a 5 m stub
still gets one arrow; 500 segments inside one cell collapse to one; `onRoad` keeps `lon/lat` on
the segment; the wave phase repeats every six cells; the ported direction test; the size clamp.

### Rendered and judged

Desktop 1440 × 900 at zoom 13.5, 14.5, 15.5, 16.5, 17.5 and a 390 px phone at 13, on a 4.4 m/s
day. The lattice at 13 – 15.5 is exactly the reference: rows and columns, one arrow each, size
and colour varying with the street beneath. At 16.5 and 17.5 the arrows follow the roads one pitch
apart with no pile-ups. 32 px was also rendered: denser, arrows 6 – 13 px, too faint on the
cream ground; 40 px is the default and `ARROW_SPACING_PX` is the one knob.

### Acceptance

`npm run check`, `npm run build`, push. Then DJ's three screenshots as before — the opening view,
`=` ×3, `=` ×4 — judging two things only: whether the lattice reads as organised on the real
streets, and whether the wave (which no still image shows) is calm enough. Knobs if not:
`ARROW_SPACING_PX` (40), `ALPHA_MIN` (0.7), `RATE` (0.25), `WAVELENGTH_CELLS` (6). The tooltip
caveat from step 5 stays parked until the arrows are settled.

### Completed 2026-09-04 — commit `a63d4b2`

Applied with `git apply --3way step5c.patch` on `84d35cc`: all three files clean, no conflicts.
`npm run check` green, **127 tests** (was 123 — the 5b density cases are replaced by the eight
lattice cases). `npm run build` clean. Pushed to `fix/map-legibility`. The patch file was deleted
before the commit and was never committed.

**Changed beyond the patch: nothing.**

**One thing the patch carries, left exactly as shipped:** the comment block above
`sizeForSpeed()` in `FlowLineLayer.ts` now holds two paragraphs that contradict each other. The
hunk kept the 5b text as context ("8 px … 22 px … ≥ 6.4 → 22") and added the 5c paragraph
("10 px … 18 px") beneath it. Comment only, so it cannot affect check or build, but the next edit
of that file should delete the older paragraph.

**Unverified visually:** everything this step changes. The lattice was rendered headless on the
Cowork side (recorded above); nobody has seen it on the real basemap. DJ's three screenshots — the
opening view, `=` ×3, `=` ×4 — judge whether the lattice reads as organised on real streets and
whether the wave is calm enough.

---

## Step 6 — Bike-type picker

Only after 5b and 4c. Sets `baseSpeedMs` and `windSensitivity` together in `CyclingParams`:

| key | label | baseSpeedMs | windSensitivity | maxSpeedMs |
|---|---|---|---|---|
| `city` | City bike | 4.2 (15 km/h) | 0.55 | 7.0 |
| `commuter` | Commuter *(default)* | 5.0 (18 km/h) | 0.50 | 8.5 |
| `road` | Road bike | 7.2 (26 km/h) | 0.42 | 11.0 |
| `ebike` | E-bike | 6.7 (24 km/h) | 0.15 | 7.0 |

`maxSpeedMs` is per type because `effectiveSpeed()` clamps to it: the default 8.5 would cap a road
bike's tailwind gain at +1.3 m/s, and an EU e-bike's assist cuts at 25 km/h (6.9 m/s), so its
tailwind gain is small by law, not by aerodynamics. `minSpeedMs` and `headwindThresholdMs` stay as
they are for every type.

E-bike is a separate row for a physical reason: the motor holds speed into a headwind, so wind costs
battery range rather than legs and `windSensitivity` collapses toward zero.

**Do not ask for rider weight.** Mass enters only through rolling resistance, which is
wind-independent, so it cancels completely out of the extra power a headwind costs. A 70 kg and a
110 kg rider both lose 91.9 W to a 5 m/s headwind at 18 km/h. Weight changes only the
equivalent-gradient readout, and there it runs backwards from intuition (2.68% at 70 kg, 1.70% at
110 kg for the same wind).

**Where it lives.** `src/cyclist/bikeTypes.ts`: the table above as `BIKE_TYPES`, a `BikeType` key
union, and `paramsFor(key): CyclingParams` spreading `DEFAULT_PARAMS`. Test that every entry
satisfies `minSpeedMs < baseSpeedMs < maxSpeedMs` and that `paramsFor('commuter')` equals
`DEFAULT_PARAMS`.

**How it reaches the router.** The worker plans with `DEFAULT_PARAMS` today. Add `params` to the
`'plan'` message (`routingWorker.ts` `InMsg`), pass it through to `planRoutes(graph, s, g,
msg.wind, msg.params)`, and include `bikeType` in the `useEffect` dependency list that posts the
plan so a change re-plans. The step 4c re-pricing call in `App.tsx` uses the same params.

**State.** `const [bikeType, setBikeType] = useState<BikeType>(readStoredBikeType)` in `App.tsx`,
persisted to `localStorage` under `cph-wind:bike` inside try/catch; a missing or unknown value
means `commuter`.

**The control.** The inert `Commuter bike, 18 km/h` span in the panel footer becomes the picker.
Same type, same `COLORS.faint`, same row — it is a `quietControl` button that reads
`{label}, {km/h} km/h` and, when tapped, swaps the footer row for four quiet buttons (`City bike ·
Commuter · Road bike · E-bike`, the active one in `COLORS.accent`), collapsing back on a choice. No
modal, no select element, no new visual vocabulary. Also show the choice on the "Plan a route"
launcher's second line: `Search, tap the map, or use GPS · Commuter`.

Never gate the map behind the picker. Default first, adjust later.

### Acceptance

`npm run check`, `npm run build`. Screenshot the panel footer collapsed and expanded, and one
route re-planned as a road bike beside the same route as a city bike — the minutes should differ,
the distances should not.

---

## Merge order

1. Steps 5b, 4c and 5c all go on `fix/map-legibility`. One PR to `main` when all three are recorded here.
   `feat/route-panel-redesign` is a strict subset of it (verified 2026-09-04) — delete the branch
   after the merge, do not merge it separately.
2. Step 6 starts from `main` after that merge, on `feat/bike-type`.

## Verification before merge

1. `npm run check` green (lint + `vitest run`). Never `npm test` — it is watch mode and hangs.
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
