# cph-wind — Ranker fix and panel rebuild

Written 2026-09-03. Scoped deliberately. Do the steps in order. Do the steps in order. Step 4 depends on step 1's tie flag and on step 2a's corrected wind.
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
swatch and marginally on an 8 px anti-aliased arrow over a light basemap. The palette is finished;
the remaining lever is size and decimation. `FlowLineLayer.sizeForSpeed()` clamps to 3–9.5 px —
widen the range and check density at zoom 13 as well as 16.

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

---

## Step 6 — Bike-type picker

Only after steps 1–5. Sets `baseSpeedMs` and `windSensitivity` together in `CyclingParams`:

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
