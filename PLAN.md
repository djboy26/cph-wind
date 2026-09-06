# cph-wind — Ranker fix and panel rebuild

Written 2026-09-03, reviewed 2026-09-04, queued for auto mode 2026-09-06 (see "The queue" near the end; the second queue of that evening sits after Step 5h). Scoped deliberately. Do the steps in order. Step 4 depends on step 1's tie flag and on step 2a's corrected wind.
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

**Superseded 2026-09-06.** The join is decided and built; see "Step 2b — second spec" after the
queue. The note below stands as the record of why it waited.

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

*(The vortex became Step 8 on 2026-09-06, after the model review below.)* The canyon vortex. Above λ ≈ 0.65 real canyons enter skimming flow and street-level wind reverses
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


### Reviewed 2026-09-04

`a63d4b2` is the patch byte for byte (only hunk offsets differ, from 4c landing first). Re-run
here: 127 tests, lint, build. One thing the patch left behind, flagged by the agent: the comment
above `sizeForSpeed()` now carries the step 5b paragraph ("8 px … 22 px … 'multi' density …")
directly above the 5c one. Comment only; cleaned up under "Before the PR" below.

---

## Step 5d — Field density

DJ on the 5c lattice, 2026-09-04: *"improvement for sure … I like that when I zoom in the arrows
neatly fit inside the road geometry … however I need more arrows, neatly spaced. Think of vector
arrows in physics, for magnetism or field representations."* Two things follow from a quiver
plot: the pitch is tighter, and the arrow is long relative to the pitch — 0.5 to 0.7 — so the
field reads as a field rather than as dots with gaps. 5c had 40 px pitch and arrows at 0.25 to
0.45 of it.

**Built and rendered first, as 5c was.** `step5d.patch` at the repo root is the implementation;
it applies cleanly on `9db4071` (`fix/map-legibility`) and on `feat/bike-type`, and passes
`npm run check` (130 tests) and `npm run build`. It also deletes the stale step 5b comment above
`sizeForSpeed()`, so the housekeeping item under "Before the PR" is done by this patch and is not
to be repeated.

### What changes

- `ARROW_SPACING_PX` 40 → **32**. 1.56× the arrows per area at every zoom; on a 390 px phone the
  opening view is 12 columns, on a 1440 px desktop 45.
- `sizeForSpeed` → `clamp(14 + 1.6·v, 14, 22)` px (+2 on phones). Longest arrow 22 px on a 32 px
  pitch: 0.69, and two neighbours pointing along the same lattice axis keep a 10 px gap. 14 px is
  where the head still reads on the light ground. 1.1 m/s → 15.8 px, 3.17 → 19.1, ≥ 5 → 22.
- **Rows across wide roads**, on-road regime only. Each segment also offers candidates at lateral
  offsets ±j·pitch for `j ≤ floor(0.3 × canyonW / pitch)` — `CROSS_FRACTION = 0.3` of the
  building-to-building width, which is inside the carriageway for a Copenhagen boulevard. A 20 m
  residential canyon gets nothing extra until the last zoom level (pitch < 6 m); a 50 m boulevard
  gets three rows from zoom 17 and five at 18. `FlowLine` gains `baseCrossM`, applied in
  `arrowPosition` along `bearingDeg + 90`. The lattice regime ignores it.
- Tests: the size clamp updated; three new cases for the rows (wide street → `[-16, -8, 0, 8, 16]`
  at 8 m pitch on a 60 m canyon; 20 m canyon → no rows at 8 and 16 m, `[-4, 0, 4]` at 4 m; lattice
  regime → never).

### Rendered and judged

Desktop 13.5 / 14.5 / 15.5 / 16.5 / 17.5 and a 390 px phone at 13, 4.4 m/s day. The lattice is now
a quiver plot: dense, regular, arrows two thirds of the pitch. At 17.5 H.C. Andersens Boulevard
carries a five-row field filling the carriageway; side streets a single row one pitch apart.

### Acceptance

`npm run check`, `npm run build`, push. DJ's three shots, opening view / `=`×3 / `=`×4, and one
sentence: field, or clutter. The knobs are `ARROW_SPACING_PX` (32), the two size constants, and
`CROSS_FRACTION` (0.3).

### Completed 2026-09-04 — commit `6c264ee`

Applied with `git apply --3way step5d.patch` on `aa3476f`, the `fix/map-legibility` tip after the
four `PLAN.md`-only commits were cherry-picked across from `feat/bike-type` (all four clean): all
three files clean, no conflicts. `npm run check` green, `npm run build` clean. Pushed. The patch
file was deleted before the commit and never committed.

**130 tests** in this tree, across 11 files (was 127). The `npm run check` run itself
printed 263: an untracked nested clone of the repo, `cph-wind/`, was sitting at the repo root
(the reviewer's render checkout, dated 23:04) and vitest recursed into it and ran its 133
tests in 12 files as well. Those are not this tree's tests. 130 comes from a second
one-shot run of the same tree with `**/cph-wind/**` excluded, and 130 + 133 = 263.
The clone was left exactly where it was found and nothing from it is committed. Delete it, or add
`cph-wind/` to `.gitignore`, before the next run, or every count will be doubled again.

**Changed beyond the patch: nothing.** Files in the commit, from `git show --stat`:

```
src/App.tsx                      |  4 ++--
 src/layers/FlowLineLayer.test.ts | 36 ++++++++++++++++++++++++++++++++----
 src/layers/FlowLineLayer.ts      | 39 +++++++++++++++++++++++----------------
 3 files changed, 57 insertions(+), 22 deletions(-)
```

The stale step 5b paragraph above `sizeForSpeed()` went with the patch, as its note says; the
"Before the PR" housekeeping item was not repeated.

**One thing out of order, recorded for honesty.** The first attempt to write this block failed on
a wrong anchor in the recording script, and a flaw in how the commands were chained let item 5 run
before that failure was acted on: `feat/bike-type` was rebased onto `6c264ee` and force-pushed as
`ac684a2`, the four cherry-picked commits dropping as already upstream and only "Step 6: bike-type
picker" remaining on top. That is exactly item 5's result, one step early, and nothing was
half-done. Item 5 is repeated after this record so `feat/bike-type` carries it too.

**Unverified visually:** the whole field. Pitch 32 px, arrows 14–22 px, rows across wide roads
from zoom 17. DJ's three shots — opening view, `=`×3, `=`×4 — and one word: field, or clutter.

### Reviewed 2026-09-04 — DJ's verdict: clutter; two causes found, one of them not the arrows

DJ's phone screenshot at street zoom (Nørrebrogade / Ravnsborggade, 3.5 m/s from WSW):
*"Road geometry not fully followed, not all roads have arrows. The wind direction matches the
road direction in many many cases — is that correct or a lazy sloppy mistake?"*

**Cause 1, missing roads — the data, not the layer.** `compute-cross-sections.mjs` cuts each OSM
way at its own vertices and drops every piece shorter than 20 m. In dense Copenhagen a curve is
digitised as many short chords and a junction as stubs, so those go. Measured on the shipped tiles
in a 0.9 × 0.9 km box around the screenshot: **12.2 km of road, 10.1 km with any segment (83 %)**,
21 of 186 ways with nothing at all, and the pieces that survive are spaced by OSM's digitiser, not
by us. No placement rule can draw an arrow on a road that has no segment. Fixed in step 5e.

**Cause 2, arrows along the road — the canyon model, on purpose, and mostly right.** See "The
canyon model, reviewed" below. Short form: for a wind hitting a street obliquely, the cross-street
component is blocked by the walls and the along-street component is not, so the flow at rider
height turns toward the street axis. On the screenshot: ambient toward 67°, Nørrebrogade's axis
~125°, λ = 0.33 — the model gives 94°, between the two, and the tooltip says exactly that. On the
narrow side street (λ near 1) it lies almost along the axis. That is textbook channelling, not
sloppiness. Two things the model does get wrong are listed in the review; neither is what the
screenshot shows.

**Clutter** — DJ gave one word and one street-level shot. The knobs are in step 5d's acceptance.
Not touched until the coverage fix is seen, because 17 % of the roads arriving will change the
picture.

---

## Step 5e — The fixed field: every road, arrows across the carriageway, bike lanes

DJ, 2026-09-04, after 5d, with a sketch over Google Maps of Amager Boulevard: long arrows
spanning the carriageway, evenly spaced along it, all parallel to the wind; and *"we are not
really using bike lane maps here — we must."* Earlier the same evening: *"no empty road; many
closely spaced arrows on every road, their coordinates and lengths fixed; strength as colour or
fading; fixed on each road of greater Copenhagen."*

Everything below is in `step5e.patch` at the repo root, built and rendered here before this was
written. It applies cleanly on `f0cdd0f` (`fix/map-legibility`) and on `feat/bike-type`; lint,
136 tests and the build pass; `npm run data:validate` passes on the regenerated data.

**1. Every road has data.** `compute-cross-sections.mjs` resamples each way along its centreline
into `n = round(L / 30)` pieces of exactly `L / n` metres instead of cutting at OSM's vertices and
dropping pieces under 20 m, which left 17 % of central Copenhagen's road length with nothing.
Ways under 6 m (junction stubs) get nothing; everything else is tiled without gaps. Each piece
records `startM` (its start distance along the way) and the way's class rank; the tiles carry
both (`fields` in `segtiles/index.json` grows by two).

**2. Every road is in the data.** `fetch-osm.mjs` gains `trunk`, all `*_link` classes,
`pedestrian`, `service` (except driveways, parking aisles, drive-throughs, emergency access) and
`path` with `bicycle=yes` as well as `designated`, and keeps `cycleway:left/right/both` folded
into the `cycleway` property so a road with a track on one side counts. Overpass is unreachable
from the review sandbox, so this part is verified only by auto mode running the fetch; its
timeout is 300 s. If Overpass fails, the step continues on the existing roads file and says so.

**3. Fixed coordinates, spaced by geometry, never overlapping.** `buildFlowField(segments, wind,
{ mpp, isMobile })` in `FlowLineLayer.ts`:

- Every way carries candidate points at fixed world positions `i × 3 m` from its first node.
  A point's coordinate never depends on zoom or viewport.
- **An arrow spans its carriageway**: class width (16 / 13 / 10 / 7 m for arterial … residential,
  3.5 m cycleway, 5 m service) or half the canyon if that is wider, never more than the canyon;
  floored at 16 px on screen so zoomed-out arrows stay legible.
- **Along-road spacing follows the sketch**: 0.4 × the arrow's on-screen length, never under
  28 px, and never so tight that parallel arrows touch — two arrows *s* apart along a road, both
  at angle θ to it, are *s*·sin θ apart across and *s*·cos θ along their own axis, and either
  24 px across or length + 12 px along is enough. Wind along a road: tip to tail. Wind across it:
  a comb. Zooming out keeps every *k*-th point, so the drawn set at any zoom is a subset of the
  set at any closer zoom.
- Two passes decide contested space, both deterministic: one candidate per 28 px cell by rank
  (arterial > residential > cycleway > service, then lower way id, then lower index), then every
  winner in that order is kept only if its centre is at least 21 px from every kept centre and
  outside every kept arrow's capsule (its length plus 12 px, 24 px wide) — tested in both arrows'
  frames, so crossing arrows never cut through each other. A cycleway beside its road draws
  nothing where the road's arrows already lie.
- The 650 / 1700 street cap and its index stride are gone; the screen cells are the cap.

**4. Two layers per arrow, strength as opacity.** A `LineLayer` shaft (3 % of length, 2 – 8 px)
from tail to a head-length short of the tip, and an `IconLayer` head (`public/arrowhead.svg`, 15 %
of length, 12 – 36 px) anchored at the tip. Both carry the same objects, so tapping either gives
the tooltip its street. Colour stays the six-band shelter ratio, which on any one day *is* the
strength ranking. Absolute strength is opacity, `0.55 + 0.45 · min(v / 5, 1)`: a calm day's field
is translucent, a gale's is solid. The brightness wave modulates that by ±15 %. `sizeForSpeed` is
gone; `alphaForSpeed` replaces it and the "two channels, deliberately" comment is rewritten.

**5. Bike lanes.** From the same roads file the router uses, from zoom 15: dedicated cycleways as
a 2 px green line, roads carrying a `cycleway` value in {track, lane, shared_lane, separate,
segregated, opposite_*, designated} as a 1.5 px lighter one. `PathLayer`, below the arrows, above
the buildings, rebuilt only when the roads file lands.

**Numbers, from running it** (existing roads file): 59,750 segments → **118,002**;
`cph-segments.json` 21.7 → 47.7 MB (under GitHub's 50 MB warning — do not lower `STEP_M` below
30 without checking this); tiles 7.05 MB, largest 117 KB, average 52 KB; Nørrebro box coverage
83 % → 100 %. One test tolerance loosens: `windCategory.test.ts` "same picture whatever the wind
is doing" compared occupancy to six decimals of a percent; with 118k × 24 evaluations a segment
on a band edge crosses it on floating-point noise, so three decimals now.

**Rendered.** Desktop 13.5 / 15.5 / 16.5 / 17.5 / 18.5 and a phone at 13. At 18.5 Amager-scale
boulevards carry long parallel arrows across the carriageway, heads and all — the sketch. At 16.5
and 17.5 a comb along every wide road, single arrows along narrow ones, bike lanes in green. At
13.5 the arrows trace the road network. Nothing is placed off a road at any zoom; no two arrows
touch at any zoom (that is a test, not an observation).

### Auto mode

```
git apply --3way step5e.patch && rm step5e.patch
node scripts/fetch-osm.mjs          # allowed by this step; on failure, continue and say so
node scripts/compute-cross-sections.mjs
node scripts/tile-segments.mjs
npm run data:validate
npm run check && npm run build
git add -A && git commit
```

Report the three printed numbers: `Total segments`, the `cph-segments.json` size, and `largest
tile`. Without the refetch they are 118002, 47.66 MB, 117.2 KB; with it they will be larger — say
by how much. If `cph-segments.json` exceeds 50 MB, stop before committing and report; the fix is
`STEP_M = 35`, not a force-push. The commit is large (about 142 data files); that is expected.

### Acceptance

DJ's three shots, opening view / `=`×3 / `=`×4, plus one at maximum zoom on a boulevard he knows,
against the sketch. The claims to check: no road without arrows; arrows spanning the road, evenly
spaced along it; no two arrows touching; green bike lanes where he knows there are lanes; the same
arrows in the same places after zooming out and back in.

### Completed 2026-09-05 — commit `19bb22e`

Applied with `git apply --3way step5e.patch` on `3a38305` (it fell back to direct application on
every file, and every file applied clean). The patch file was deleted before the commit and never
committed. Then, in the Auto mode order: refetch, `compute-cross-sections`, `tile-segments`,
`npm run data:validate` (passed), `npm run check` (green, **136 tests** in 11 files),
`npm run build` (clean). Pushed. The nested `cph-wind/` clone was confirmed to have no unsaved
work and deleted before the run, so the count is the tree's own.

**The refetch ran.** `fetch-osm.mjs` fetched in 10.6 s and wrote **37,799 ways,
11.03 MB** to `cph-roads.json`.

**The three numbers, from the scripts' own output** (the step's no-refetch baseline alongside):

| number | this run | without refetch |
|---|---|---|
| `Total segments` | **159,201** | 118,002 |
| tiles | 159 tiles, **9.47 MB**, largest **160.1 KB**, average 61.0 KB | 7.05 MB, largest 117.2 KB |
| `cph-segments.json` | **64.51 MB, now untracked** | 47.66 MB |

**The 50 MB stop fired, and was resolved by untracking, not by `STEP_M`.** With the refetch the
monolith came out at 64.51 MB, over the line this step set. `STEP_M = 35`, the remedy named
above, would have landed near 55 MB, still over. Decided by DJ 2026-09-05: keep `STEP_M = 30`,
add `public/data/cph-segments.json` to `.gitignore` and `git rm --cached` it. It is an
intermediate that only `tile-segments` and the validator read; the app loads the tiles.
CLAUDE.md's Data pipeline line now says so and how to regenerate it locally.
`grep -rn "cph-segments" src api` returns nothing.

**Changed beyond the patch, all on instruction:** the `.gitignore` line, the CLAUDE.md line, and
the untracking of `cph-segments.json`; plus the regenerated data. Files in the commit: 173,
`173 files changed, 673 insertions(+), 387 deletions(-)`.

**Unverified visually:** all of it. DJ's three shots, opening view / `=`×3 / `=`×4, plus one at
maximum zoom on a boulevard he knows, against the sketch. The claims to check: no road without
arrows; arrows spanning the road, evenly spaced along it; no two arrows touching; green bike lanes
where he knows there are lanes; the same arrows in the same places after zooming out and back in.

---

## Step 5f — The road lattice: short arrows, side by side, all along

DJ on 5e, with a scratch of the intent confirmed 2026-09-04 evening: *"the arrow length is
ridiculously too long; I need multiple such arrows side by side."* The confirmed picture: short
arrows of one length, several side by side across the carriageway, repeated all along it in a
regular lattice, every one parallel to the wind. The lattice belongs to the road and never moves;
only the arrows' direction comes from the wind.

`step5f.patch` at the repo root is the implementation, built and rendered here; it applies
cleanly on `6de9422` and on `feat/bike-type`; lint, 135 tests and the build pass. No data changes.

**What it does** (`FlowLineLayer.ts`, replacing 5e's spanning arrows):

- Every way carries a lattice in its own frame: points every `LATTICE_M = 3` m along it from its
  first node (`startM` from the pipeline) and every 3 m across it from the centreline, out to the
  carriageway edge less a 1.5 m margin (`roadWidthM`: class width, or half the canyon if wider,
  never more than the canyon; 3.5 m for a cycleway). Zooming out keeps every *k*-th row and
  column, `k = ceil(34 px / (3 m / mpp))`, so the on-screen pitch stays within a few pixels of
  34 px at every zoom. Rows drop away as the road narrows on screen; positions never move — an
  arrow is only ever drawn on a 3 m lattice point of its road.
- Every arrow is the `arrow.svg` glyph at **22 px** (24 on phones): 0.65 of the pitch, so
  lattice neighbours never touch whatever the wind does. The 5e shaft-and-head pair and
  `public/arrowhead.svg` are gone.
- Contention as in 5e, simplified because every arrow is the same length: one candidate per
  34 px cell by rank (arterial > residential > cycleway > service, then the centre row, then
  the lower way id, then the lower index), then every winner kept only if its centre is at least
  0.75 × pitch from every kept centre. Deterministic.
- Colour = shelter band, opacity = absolute strength, brightness wave — all unchanged from 5e.

**Numbers.** Rows across at zoom 18.5 (3.4 m pitch, k = 2, 6 m): a 30 m boulevard carriageway
carries five (±12 m), a 10 m residential street one (three at the last half-level, where k = 1).
At zoom 16 (k = 5, 15 m) everything is a single row. At 13.5 (k = 43, 129 m) the arrows trace
the network one every 34 px.

**Tests** (`FlowLineLayer.test.ts`, rewritten): `roadWidthM` cases; rows across a 30 m
carriageway at ±12 m; a 20 m residential canyon one row, three at 3 m pitch; a cycleway one row
at every zoom; columns on the 3 m grid from the way start, every *k*-th; positions from the way
not the piece; every arrow on a lattice point at three zooms; a cycleway beside its road adds
nothing and the road keeps its lattice; input order irrelevant; minimum centre distance ≥ 0.75 ×
pitch on a crossing grid at four zooms; one glyph size; opacity by speed; wave phase; direction.

**Rendered.** Desktop 13.5 / 15.5 / 16.5 / 17.5 / 18.5 and a phone at 13. At 18.5 the boulevard
is panel 2 of the scratch: rows across, columns along, all parallel. At 16.5 – 17.5 one row per
street with two or three on the wide ones. At 13.5 the arrows trace the network.

### Auto mode

Item 1 of "The queue" below; the commands live there. (The CLAUDE.md sentence the 5e edit
dropped is back in the working copy and goes in with the queue's preflight commit.)

### Acceptance

The harness (Step 7) proves the arrows are drawn; the look is DJ's call from the production
build after item 3: opening view / `=`×3 / `=`×4 / maximum zoom on Amager Boulevard, against
panel 2 of the scratch. Then the pitch: 34 as built, or 28, or 40 — one number.

### Completed 2026-09-06 — commit `fbd8724`

Applied with `git apply --3way step5f.patch` on `f1783f8` — the branch after item 0 committed the
queue docs as `8c5f51a` and cherry-picked Step 6 (`25aaac1`) in as `f1783f8` — clean on every file.
The patch file was deleted before the commit and never committed. `npm run check` green,
**141 tests**, the count the queue expects. `npm run build` clean. Pushed.

Changed beyond the patch: nothing. `public/arrowhead.svg` went with it, as the step says; the
5e shaft-and-head pair is gone.

For a person, from production after item 3: the lattice pitch on the real basemap — opening
view / `=`×3 / `=`×4 / maximum zoom on Amager Boulevard, against panel 2 of the scratch — and
then the one number: 34 as built, or 28, or 40.

---


## Step 7 — The screenshot harness

Every step so far has been judged from a Vercel preview by a person, or rendered headless on the
review side. Neither is available to an autonomous run, so nothing objective has ever gated a
commit on what the app draws. This step adds that gate: a script that builds nothing new, opens
the built app in headless Chromium at fixed views with a fixed wind, and asserts that arrows were
drawn and routes were planned before it writes a picture.

`step7.patch` at the repo root is the implementation, built and run on the review side on top
of `feat/bike-type` + `step5f.patch`; lint, 141 tests and the build pass, and the harness passes
(17 shots, 3 routes, picker open). No data changes.

**What it does.**

- `scripts/shots.mjs` (`npm run shots -- <label>`) serves `dist/` on a free port
  (`scripts/shots/serve.mjs`, no dependencies), mocks `/api/wind` with a MET-shaped fixture
  (`scripts/shots/fixture.mjs`) and opens seven views × two winds (4.4 m/s from 240°, 9 m/s from
  300°): the opening view on desktop and phone, zoom 16.5 / 17.5 / 18.5 at H.C. Andersens
  Boulevard (55.6754, 12.5687) at pitch 0, 17.5 at pitch 40, and 17.5 on a phone. Then the
  onboarding hint once, the empty route panel, a shared route with its three options, and the
  bike-type picker when the build has one. Output: `docs/renders/<label>/*.png` (gitignored,
  they stay on the machine for the reviewer) and `docs/renders/<label>/report.md` (committed).
- Views are named in the URL hash so every run opens the same place:
  `#z=17.5&lat=55.6754&lon=12.5687&pitch=0&bearing=0` (each key optional, clamped to the
  camera limits) and `#s=55.6835,12.5713&e=55.6656,12.5786` for a route. `App.tsx` reads both
  once at mount. The route form is what a rider can share too.
- `App.tsx` exposes `window.__cphwind = { zoom, arrows, tiles, windMs }`, refreshed whenever the
  field rebuilds. The harness polls it and **fails the run** (exit 1) when a view draws fewer
  arrows than its minimum (200 on desktop street views, 100 at 18.5, 50–60 on a phone), when no
  route option appears within 60 s, or when the page throws. Basemap tile failures are reported,
  not fatal, so an offline machine still gets the app's own layers.
- The onboarding hint is seeded as dismissed (`localStorage` `cphwind.onboarded.v1`) in every
  context but the one that photographs it; clicking "Got it" from a script was flaky.
- One real fix, found by the harness: a route named before the roads file had landed was never
  planned, because the worker dropped a `plan` posted before `init`. `graphReady` is now state,
  set on the worker's `ready` message, and the plan effect waits for it.

**Numbers from the review-side run** (basemap blocked there, so the app's own layers only):
opening view 2110 arrows on desktop, 494 on a phone; 16.5 → 1195; 17.5 → 1788; 18.5 → 2569;
17.5 at pitch 40 → 2636; the shared route Nørreport → Islands Brygge gives 9 / 10 / 10 min.

### Acceptance

`npm run shots -- step7` prints `PASS`, and `docs/renders/step7/report.md` says
`Basemap: loaded from CARTO` — on DJ's machine the basemap must load; if the report says NOT
loaded, the machine is offline and the run does not count.

### Completed 2026-09-06 — commit `ef45854`

Applied with `git apply --3way step7.patch` on `283f831` (Record Step 5f): `package.json` and
`src/App.tsx` clean, the three script files as new files. The patch file was deleted before the
commit and never committed. `npm install` wrote playwright into the lockfile; `npx playwright
install chromium` put the browser in the user's cache, not the repo. `npm run check` green,
**141 tests**, the count the queue expects. `npm run build` clean. `npm run shots -- step7`
ended `PASS` after 5½ minutes; `docs/renders/step7/report.md` says `Basemap: loaded from
CARTO.` — every view loaded all of its basemap tiles (19/0, 11/0 or 9/0 per view), no browser
errors. 17 shots and the picker, on this machine. Pushed.

**Arrow counts from `report.md`.** The same under both winds (4.4 m/s from 240° and 9 m/s
from 300°), and each one equal to the review-side number to the arrow:

| view | arrows | minimum |
|---|---|---|
| opening view, desktop (zoom 13.5) | 2110 | 200 |
| opening view, phone (zoom 13) | 494 | 50 |
| 16.5, H.C. Andersens Boulevard | 1195 | 200 |
| 17.5 | 1788 | 200 |
| 18.5 | 2569 | 100 |
| 17.5 at pitch 40 | 2636 | 200 |
| 17.5, phone | 1173 | 60 |
| hint and empty panel (opening view) | 2110 | 200 and 0 |

The shared route Nørreport → Islands Brygge planned its 3 options: 9 min / 2.46 km / +46 s into
the wind, 10 min / 2.82 km / +51 s, 10 min / 2.87 km / +51 s, with the calm-day sentence
("Wind costs about 49 s whichever way you go today. Take the short one."). The picker shot shows
City bike / Commuter / Road bike / E-bike.

Changed beyond the patch: nothing. The PNGs stayed on this machine in `docs/renders/step7/`
(gitignored) for whoever reviews; only the report is in the commit.

---

## Step 5g — The lattice drawn whole

DJ, 2026-09-06, on the 5f renders: *"still disappointing. I need neatly ordered arrows, fixed
coordinates, and closely packed arrows."* Top priority. Looked at on the real basemap
(`docs/renders/step7/`, z 17.5 and 18.5 on H.C. Andersens Boulevard), 5f has three faults, all
in `buildFlowField`, none in the data:

1. **It thinned a road's own lattice.** The one-candidate-per-screen-cell pass was meant to
   settle contention *between* roads, but a road-aligned lattice at pitch ≈ cell size lands two
   of its own points in one axis-aligned cell wherever the road runs diagonally, and one was
   dropped each time. That is the irregular gap pattern in every 5f picture: rows with holes,
   columns that skip.
2. **Rows across only ever appeared at maximum zoom.** Rows were kept at `j % k == 0`, i.e. at
   multiples of the *along* pitch from the centreline, so a 16 m arterial (half-width 6.5 m)
   fitted a second row only when the pitch was ≤ 6 m, which is zoom 18.5. At 17.5 and below
   every road was one row, whatever its width.
3. **Dual carriageways were inflated.** `roadWidthM` took half the canyon width when that beat
   the class width, so each carriageway of a boulevard (its own OSM way, ~12 m of tarmac) was
   treated as 22 m wide and its outer rows sat on the median and the footway.

`step5g.patch` is the fix; `FlowLineLayer.ts` and its tests only. Nothing else in the app
changes: the two colour/opacity channels, the brightness wave, the tooltip, the data.

**What it does.**

- **Pitch** 26 px on desktop, 28 on phones (5f: 34); **glyph** 19 px, 21 on phones (5f: 22).
  Closely packed: the arrow is 0.73 of the pitch. The pitch in metres is a whole number,
  `pitchM = ceil(PITCH_PX × mpp)`: 5 m at zoom 18.5, 7 at 18, 9 at 17.5, 18 at 16.5, 141 at 13.5.
- **Columns** along every road at multiples of the pitch from the road's first node (`startM`),
  **rows** across it at the same pitch, as many as fit inside the carriageway, centred
  (`rowOffsetsM`): an arterial (16 m class width, 1.5 m margin each side) carries 3 rows at
  18.5 (−5, 0, +5 m), 2 at 17.5 (±5 m), 1 at 16.5; a secondary (13 m) the same; a tertiary
  (10 m) 2 rows from zoom 17.8; a residential street (7 m) 2 rows from 18.3, else 1; a cycleway
  1 row always. A boulevard mapped as two carriageways plus two cycle tracks therefore shows
  3 + 3 + 1 + 1 = 8 lines of arrows at 18.5 and 2 + 2 + 1 + 1 = 6 at 17.5.
- **Road width** is the class width, never more than the canyon (16 / 13 / 10 / 7 / 3.5 / 5 m by
  rank). The half-canyon inflation is gone.
- **A road's own lattice is never thinned.** Every column × every row is drawn. The only
  same-road drop is a true duplicate (a piece boundary counted by both pieces, the inside of a
  sharp bend): centres closer than 0.5 × pitch.
- **Contention only between roads.** Roads are taken in rank order (arterial > secondary >
  tertiary > residential > cycleway > service, then lower way id), each road centre row first;
  a point is kept unless a kept point of *another* road is within 0.7 × pitch. So at a junction
  the arterial's grid is complete and the side street's grid has a hole around it; a cycle track
  running 2–3 m from a carriageway's outer row yields to it, one further away keeps its own row.
  Deterministic: the same view always draws the same arrows.
- **Fixed coordinates.** At a given zoom every arrow sits on a whole-metre mark of its road's
  own frame, fixed to the road; nothing about the lattice depends on the viewport, the time or
  the wind, so panning never moves an arrow and the animation never does either. Zooming
  changes the pitch (whole metres), so which marks carry arrows changes with zoom, as it must for
  the on-screen spacing to stay 26 px.

**Rendered on the review side** (the app's own layers; no basemap there), against the 5f
renders on the real basemap: at 18.5 each boulevard carriageway is three complete rows in
straight columns; at 17.5 Vesterbrogade is four parallel lines (two carriageways, two cycle
tracks) in step; at 16.5 one regular row per street. Arrow counts, 4.4 m/s from 240°: opening
view 4561 desktop / 1031 phone; 16.5 → 1901; 17.5 → 2591; 18.5 → 4101; 17.5 pitch 40 → 3826;
17.5 phone → 1709 (5f: 2110 / 494 / 1195 / 1788 / 2569 / 2636 / 1173).

**Tests** (`FlowLineLayer.test.ts`, rewritten, 21): `pitchM` whole metres and ≥ 26 px at six
zooms, phones +2 px; `roadWidthM` class width capped by the canyon; `rowOffsetsM` exact rows
for an arterial at three zooms and a residential street, symmetric, ≥ pitch − 1 apart, inside
the half-width + 0.5; a lone arterial at 18.5 is the complete 13 × 3 grid (39 arrows, nothing
thinned); two rows at 17.5 on an arterial and one on a residential street; a cycleway one row at
every zoom; columns on multiples of the pitch from the way start (a piece from 40 m carries 45,
54, …, 99 at 9 m); every arrow on a whole-metre mark at three zooms; two consecutive pieces
share their boundary column once (25 columns over 120 m); a 6 m stub keeps an arrow; a cycleway
4 m from its road yields entirely and the road keeps all of its own; a crossing street keeps its
lattice except within 0.7 pitch of the arterial's arrows; input order irrelevant; no two arrows
of different roads within 0.7 pitch on a crossing grid at four zooms; glyph 19 / 21 px; opacity
by speed; wave phase 1/6 per pitch downwind; direction is the wind vector.

### Acceptance

`npm run shots -- step5g` PASS with the basemap loaded; then DJ, on production after the ship:
maximum zoom on H.C. Andersens Boulevard shows straight rows and columns with no holes on the
carriageway; `=`×4 shows two rows per carriageway; every street has arrows at one spacing.

### Completed 2026-09-06 — commit `136b36a`

Applied with `git apply --3way step5g.patch` on `ec8de06`: the queue text for this item (this
section, item 2b, the amended item 3) was committed just before as `ec8de06`, PLAN.md only, so the
step commit carries the patch alone — `FlowLineLayer.ts` and its tests, clean. The patch file was
deleted before the commit and never committed. `npm run check` green, **145 tests**, the
count the queue expects. `npm run build` clean. `npm run shots -- step5g` ended `PASS`;
`docs/renders/step5g/report.md` says `Basemap: loaded from CARTO.` No browser errors. Pushed.

**Arrow counts from `report.md`**, this machine, against the review-side numbers:

| view | arrows | review side |
|---|---|---|
| opening view, desktop | 4561 | 4561 |
| opening view, phone | 1031 | 1031 |
| 16.5, H.C. Andersens Boulevard | 1901 | 1901 |
| 17.5 | 2591 | 2591 |
| 18.5 | 4101 | 4101 |
| 17.5 at pitch 40 | 3826 | 3826 |
| 17.5, phone | 1709 | 1709 |

17.5 is 0.0% off 2591 and 18.5 is 0.0% off 4101, inside the few percent the queue
allows. The shared route planned 3 routes.

Changed beyond the patch: nothing.

For a person, on production after the ship: the boulevard lattice at maximum zoom (straight rows
and columns, no holes on the carriageway) and at `=`×4 (two rows per carriageway); every street
at one spacing.

---

## Step 5h — The road band, size B, and the opacity floor

DJ, 2026-09-06 evening, on 5g in production (phone, maximum zoom on H.C. Andersens
Boulevard): *"the arrow size at the highest zoom is still too big, also they are outside the
road geometry — why?"* Answered with pictures and two choices; he chose the road band and
size B.

**Why the arrows sat outside the road.** The basemap (CARTO Positron) draws every road at a
symbolic pixel width by class, not at its real width. At maximum zoom that white line is about
4 m wide for a carriageway that is 10–12 m of tarmac, so a lattice that is right in metres
(rows at ±5 m) spills past the drawn line onto what the basemap paints as land. The 5g rows
were on the real road; the picture said otherwise. Nothing in the data or the lattice was
wrong; the reference it was judged against was.

`step5h.patch`: `App.tsx`, `FlowLineLayer.ts` (+ test), `scripts/shots.mjs`. Applies cleanly
on `main` (614651b) and on `feat/canyon-vortex` (7abc9de); rehearsed both, and the merge of
one into the other. 145 tests on main, 158 on the branch. Harness PASS on the review side.

**What it does.**

1. **The app draws the road surface itself** from zoom 16 inward (`ROAD_BAND_MIN_ZOOM`): one
   `PathLayer` path per 30 m piece, `widthUnits: "meters"`, width = `roadWidthM` — exactly the
   width the lattice fills — white (255, 255, 255, 240) over a 1.2 m casing (222, 214, 199),
   rounded caps and joins so the pieces read as one road. Drawn above the buildings and below
   the bike lanes and arrows. So the arrows are inside the road by construction, at every
   zoom where the band is drawn; below 16 the basemap's own lines are about the right width
   and carry the single row. The band covers the basemap's thin line; where a boulevard is
   two OSM ways 20 m apart, the two 16 m bands meet and the median disappears under them —
   accepted, since the arrows are the point. The street pieces the field already loads feed
   it (`visibleSegments`, now shared by the field and the band), so no new data.
2. **Size B**: pitch 24 px, glyph 18 px (phones 26 / 20). Pitch in whole metres per zoom,
   desktop: 3 m at 18.5, 5 at 18, 6 at 17.5, 9 at 17, 12 at 16.5, 17 at 16, 92 at 13.5.
   Rows on an arterial (half-width 6.5 m less the margin): 5 at 18.5 (−6, −3, 0, 3, 6), 3 at
   18 and 17.5, 2 at 17 and 16.5, 1 at 16. A residential street: 2 rows at 18.5, else 1.
   (The 5g record above gave zoom labels half a level too high: 0.17 m/px is zoom 18, not
   18.5. The pitches it lists are right for the zooms one half-level lower. The tests now
   say the right zooms.)
3. **Opacity floor 0.75** (was 0.55): `alphaForSpeed = 0.75 + 0.25·min(v/5, 1)`. The palest
   shelter colour clears 3:1 on white only at full opacity; at 0.55 on the new white band a
   calm day's arrows read at 1.8:1 and all but vanished. A calm day is still visibly lighter
   than a gale.
4. **Harness**: screenshots through CDP `Page.captureScreenshot` instead of
   `page.screenshot()`, which waits on animation frames and times out on a software renderer
   where deck.gl runs at a frame a second. Same pixels; on a real GPU no difference.

**Numbers from the review side** (4.4 m/s from 240°): opening view 5177 desktop / 1169 phone;
16.5 → 2103; 17.5 → 3177; 18.5 → 6708; 17.5 at pitch 40 → 4705; 17.5 phone → 1709.

**Tests** — the 5g suite with the new constants (pitch 5 / 9 / 17 / 130 m at 0.17 / 0.34 /
0.68 / 5.4 m/px; phone 9 and 18), the 3 m row case for an arterial at 18.5, glyph 18 / 20,
opacity 0.75 floor. 21 tests in the file; 145 on main.

### Acceptance

`npm run shots -- step5h` PASS with the basemap loaded. Then DJ on production: maximum zoom
on the boulevard — every arrow inside a white road, rows straight and complete, arrows a
notch smaller than before; `=`×4 — two to three rows per carriageway.

### Completed 2026-09-06 — commit `794e66e`, branch `fix/road-band`

Cut from `main` at `96a0f9e` (after the second queue's item 0 carried PLAN.md onto main).
Applied with `git apply --3way step5h.patch`, clean: `App.tsx`, `FlowLineLayer.ts` and its
test, `scripts/shots.mjs`. The patch file was deleted before the commit and never committed.
`npm run check` green, **145 tests**, the count the queue expects. `npm run build` clean.
`npm run shots -- step5h` ended `PASS`; `docs/renders/step5h/report.md` says
`Basemap: loaded from CARTO.` No browser errors. Pushed with `-u`.

**Arrow counts from `report.md`**, this machine, against the review-side numbers:

| view | arrows | review side |
|---|---|---|
| opening view, desktop | 5177 | 5177 |
| opening view, phone | 1169 | 1169 |
| 16.5, H.C. Andersens Boulevard | 2103 | 2103 |
| 17.5 | 3177 | 3177 |
| 18.5 | 6708 | 6708 |
| 17.5 at pitch 40 | 4705 | 4705 |
| 17.5, phone | 1709 | 1709 |

17.5 is 0.0% off 3177 and 18.5 is 0.0% off 6708, inside the few percent the queue
allows. The shared route planned 3 routes.

Changed beyond the patch: nothing. The merge into `main` is recorded under the second queue.

For a person, on production: maximum zoom on the boulevard — every arrow inside a white road,
rows straight and complete, a notch smaller than before — and `=`×4, two to three rows per
carriageway.

---

## The second queue — 2026-09-06 evening, auto mode

Same rules as the first queue (top of "The queue" above): never `npm test`, never a dev
server, never commit a `.patch`, never `--force`, `git status` before every commit, stop and
record on any failure, push after every item. Items in order.

### 0 — Preflight

If a folder named `cph-wind` exists inside this repo, stop. `git branch --show-current` must
print `feat/canyon-vortex` (where the first queue ended; this PLAN.md was written on top of
that branch's copy); if it prints anything else, stop and record. `git status --porcelain` may
show only ` M PLAN.md`, `?? .claude/` and `??` lines for `*.patch`; anything else, stop.

```
git add PLAN.md
git commit -m "Plan: Step 5h and the second queue"
git push
git fetch origin
git checkout -B main origin/main
git checkout feat/canyon-vortex -- PLAN.md
git commit -m "Plan: carry the branch's PLAN.md (step 8, 2b, 9 records; Step 5h; second queue) onto main"
git push
```

After this both branches hold the same PLAN.md, so item 2's merges cannot conflict in it.

### 1 — Step 5h on a branch, then into production

```
git checkout -b fix/road-band main
git apply --3way step5h.patch
rm step5h.patch
npm run check
npm run build
npm run shots -- step5h
git add -A
git commit -m "Step 5h: the road band, size B, opacity floor"
git push -u origin fix/road-band
```

Expect **145 tests**; `docs/renders/step5h/report.md` PASS with the basemap loaded, arrow
counts within a few percent of Step 5h's numbers (3177 at 17.5, 6708 at 18.5). Completed
block under Step 5h, `Record Step 5h`, push. Then:

```
git checkout main
git pull --ff-only origin main
git merge --no-ff fix/road-band -m "Merge fix/road-band: Step 5h"
npm run check
npm run build
git push origin main
```

Production (https://cph-wind.vercel.app) now carries the road band. If `git pull --ff-only`
refuses, stop and record (local `main` was set to the remote at item 0, so only a push from
elsewhere can cause it).

### 2 — Bring the physics branch up to date and ship it

```
git checkout feat/canyon-vortex
git pull --ff-only origin feat/canyon-vortex
git merge main -m "Merge main (Step 5h) into feat/canyon-vortex"
npm run check
npm run build
npm run shots -- physics
git push
```

Rehearsed on the review side: the merge is clean (the branch's `App.tsx` changes are in the
roads-loading and worker code; 5h's are in the layer stack). Expect **158 tests** and PASS.
Then:

```
git checkout main
git merge --no-ff feat/canyon-vortex -m "Merge feat/canyon-vortex: steps 8, 2b, 9 (canyon vortex, canyon routing, copy)"
npm run check
npm run build
git push origin main
git push origin --delete feat/canyon-vortex fix/road-band
```

Under this heading add `### Shipped <date> — merges <hash>, <hash>`; commit as `Record second
queue`; push. Final report: the commit hashes per item, the Basemap and Result lines from
`step5h` and `physics`, the production URL, and the two shots that need eyes (the boulevard at
maximum zoom and at `=`×4, both on production).

### Run 2026-09-06 — stopped at `git merge main` (item 2): conflict in PLAN.md

Item 0 ran as written: `bc13db9` on `feat/canyon-vortex`, `96a0f9e` on `main`, both pushed.
Item 1 ran in full: `794e66e` Step 5h and `3891df0` Record Step 5h on `fix/road-band`;
`git pull --ff-only origin main` fast-forwarded local `main` to `9aafa5e` (one bot commit had
arrived); the merge `6c1c9bc` ("Merge fix/road-band: Step 5h") passed 145 tests and the build
and was pushed — production carries the road band.

Item 2: `git pull --ff-only origin feat/canyon-vortex` was already up to date; `git merge main`
stopped with a conflict in PLAN.md only (1 conflict hunks). `scripts/shots.mjs`,
`src/App.tsx`, `FlowLineLayer.ts` and its test, `docs/renders/step5h/report.md` and
`validation-log.ndjson` auto-merged. Why, although item 0 made the two copies identical: the
merge base of `main` and `feat/canyon-vortex` is `614651b` (where the branch was cut), whose
PLAN.md predates the step 8, 2b and 9 records, Step 5h and this queue. Both sides insert all
of that at the same places relative to that base, and `main` also has the Step 5h Completed
block inside the insertion (`3891df0`), so git sees two different insertions at one point and
refuses; identical copies merge trivially, copies that differ by one block do not.
`git diff bc13db9 main -- PLAN.md`: 1 file changed, 30 insertions(+).

`git merge --abort` restored the branch to `bc13db9`; nothing else was touched, no physics
render ran, both branches still exist on origin. This commit, on `feat/canyon-vortex`, carries
`main`'s PLAN.md (the branch's copy plus the Step 5h record) with this block added, so the
branch's copy is now the superset.

To resume, make the two copies identical again the way item 0 did, in the other direction —
on `main`: `git checkout feat/canyon-vortex -- PLAN.md`, commit ("Plan: carry the branch's
PLAN.md onto main"), push — and rerun item 2 from its first line; rehearsed here with a
throwaway commit on top of `main`: the merge is then clean.

---

## The canyon model, reviewed 2026-09-04

Prompted by DJ's question above. `canyonModifiedWind()` in `src/math/index.ts`, unchanged since
step 2a, reviewed against the street-canyon literature.

**What it does.** Takes the 10 m forecast wind, scales it to rider height (× 0.6, log law over
z₀ = 0.03 m), splits it into along-street and cross-street components against the segment's
bearing, multiplies the along component by `1 + 0.3 · min(λ, 1.5)` and the cross component by
`max(0.05, e^(−1.8 λ))`, and recombines. λ = H / W from the building walls found by ray-casting
from the segment midpoint (or a default when none are found — the `fallback` quarter of the map).
Direction at rider height is the direction of the recombined vector.

| regime (Oke 1988) | λ | what the literature says at rider height | what the model does | verdict |
|---|---|---|---|---|
| isolated roughness | < 0.3 | flow largely follows the ambient, slowed | cross × 0.6–1, along × 1–1.1 | right |
| wake interference | 0.3 – 0.65 | oblique wind turns toward the axis (helical flow, Dobre 2005) | cross × 0.3–0.6, along × 1.1–1.2 | right |
| skimming, oblique wind | > 0.65 | along-axis flow persists, cross-axis nearly gone (Soulhac 2008) | cross × ≤ 0.3, along × 1.2–1.45 | right in direction; along gain is at the high end |
| skimming, wind across the street | > 0.65 | a vortex fills the canyon; at ground the cross flow is **reversed**, ~0.2–0.3 of roof level (Kastner-Klein 2004) | cross × 0.05–0.3, **same sign** as ambient | wrong sign, small magnitude |
| junctions | — | corner vortices, flow diverted into side streets | nothing; each segment is independent | not modelled |

So the alignment DJ saw is the third row and is physically expected. The two errors:

1. **Perpendicular wind on a deep street points the wrong way.** A rider on a narrow street with
   the wind blowing straight across it feels a weak wind toward the windward wall, not away from
   it. Magnitude at 4.4 m/s ambient: about 0.5 m/s. For cycling effort it is a crosswind either
   way, so the cost is nil; for the arrow's honesty it is a sign error on perhaps a tenth of the
   map on any given day. A candidate step: below θ = 30° from perpendicular and λ > 0.65, flip the
   cross component's sign and scale it 0.25. `src/math/index.ts` is guarded; this would be its own
   step with tests, not a drive-by.
2. **Junctions.** Arrows change direction abruptly where a channelled side street meets a
   boulevard. Real flow does too, but through a corner vortex the model does not have. Out of
   scope for this milestone.

**What has and has not been validated.** The bot's `validation-log.ndjson` compares the MET and
Open-Meteo *ambient* forecasts against DMI and METAR stations at 10 m — it tells us the input is
good (currently ±1 m/s, ±15°). It says nothing about the street-level factors. The coefficients
0.3 and 1.8 and the 0.6 boundary-layer factor are literature-shaped priors, not fitted to any
Copenhagen measurement. Fitting them needs handheld anemometer runs on a dozen streets of known
λ, which is the "Out of scope" item at the end of this file and remains so.

**A copy nit seen in the same screenshot, for a later panel pass:** the tooltip's "Riding SE —
Neutral / crosswind 1.5" is a 1.5 m/s tailwind and "Riding NW" a 1.5 m/s headwind; the ±2 m/s
band is labelled as if the wind were across the street.

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

### Completed 2026-09-04 — commit `09bcbd3`, branch `feat/bike-type`

Cut from the tip of `fix/map-legibility` (`9db4071`), not from `main`, on instruction — `main` has
not been merged. `npm run check` green, **133 tests** (was 127). `npm run build` clean. Pushed.
`src/math/index.ts` untouched.

**As specified.** `src/cyclist/bikeTypes.ts` carries the table as `BIKE_TYPES`, the `BikeType`
union and `paramsFor(key)` spreading `DEFAULT_PARAMS`; `minSpeedMs` and `headwindThresholdMs` are
untouched for every type. The `'plan'` message carries `params`, the worker passes it to
`planRoutes`, and `bikeType` is in the plan effect's dependency list so a change re-plans. The
step 4c re-pricing in `App.tsx` uses the same params. State is `useState<BikeType>(readStoredBikeType)`
persisted under `cph-wind:bike` inside try/catch; missing, unknown or unreadable reads as
`commuter`. The inert footer span is now a `quietControl` button reading `{label}, {km/h} km/h`
which on tap swaps the footer row for the four type buttons, the active one in `COLORS.accent`,
collapsing on a choice. The launcher's second line reads `Search, tap the map, or use GPS · Commuter`.
The map is never gated on the picker.

**Two readings of the spec, both mine, both small:**

- The four expanded buttons sit in the existing 16 px-gap row with no "·" glyph between them; the
  middots in the spec were read as list punctuation, matching the footer already shipped.
- While the picker is open it replaces the whole footer row, "Sort by wind" included, as "swaps the
  footer row" says; the sort control comes back on collapse.

**Tests** (`bikeTypes.test.ts`, six): every type satisfies `minSpeedMs < baseSpeedMs < maxSpeedMs`;
`paramsFor('commuter')` equals `DEFAULT_PARAMS`; only the three per-type fields differ from the
default; the four keys appear once each in the table's order; the stored-value guard accepts the
four keys and rejects null, empty, unknown, wrong-case and non-string values; the km/h labels are
15 / 18 / 26 / 24. The `localStorage` round trip and the worker message live in `App.tsx` and the
worker, which have no test harness.

**Unverified visually — needs eyes on the Vercel preview:**

1. Footer collapsed: `Commuter, 18 km/h` beside `Sort by wind`, same weight and colour as before.
2. Footer expanded: four quiet buttons, the active one in accent, nothing else in the row.
3. Choosing a type collapses the row and updates the launcher's second line.
4. The same route re-planned as a road bike beside a city bike: minutes differ, distances do not.
5. Reload keeps the choice; a private window falls back to Commuter without an error.


### Reviewed 2026-09-04

Diff read in full; re-run here: 133 tests, lint, build. Rendered headless with the fixture
geocoder: footer collapsed, footer expanded (four quiet buttons, active in accent), and the same
Nørreport → Islands Brygge route re-planned three ways on a 6 m/s tailwind day — commuter
7 / 8 / 9 min, road bike 5 / 6 / 6 min, city bike 8 / 10 / 11 min, distances 2.53 / 2.81 / 3.02 km
unchanged throughout. Verdict row E ("The wind is with you today. Take the short one.") shown on
the tailwind day, which was the case 4c was written to fix. Both of the agent's readings of the
spec are accepted. Items 1–5 above stand for DJ's eyes; the reload case cannot be rendered here.

---

## The queue — 2026-09-06, auto mode

DJ, 2026-09-06: *"I do not want to take any actions on my own once it is set up. I want to run a
long auto mode that progresses the project immensely."* So this run merges steps 1–7 to
production on its own authority, gated by the harness, and leaves the physics change (steps 8,
2b, 9) on a branch with an open PR. Every step below arrives as a patch at the repo root, built
and verified on the review side; the whole chain was applied in order on a clean
`feat/bike-type` checkout and ends at 154 tests, lint clean, build clean, harness PASS (158 with Step 5g, added 2026-09-06
between items 2 and 3).

Items in order; every item ends with its checks green and a commit, or with a **Run** block
under its heading saying where it stopped and why, and nothing else touched.

**Rules for the whole run.** Never `npm test` (watch mode). Never `npm run dev`. Never commit a
`.patch` (they are gitignored; `git apply` reads them regardless). Never `--force`; if a push is
rejected, `git pull --rebase` and push again, and if that conflicts, stop. When an item stops,
the items after it do not run. A commit message names its step. Push after every item. When a
patch does not apply cleanly (`git apply --3way` reports a conflict), do not resolve it by hand:
`git checkout -- .`, record, stop.

### 0 — Preflight

If a folder named `cph-wind` exists inside this repo (a nested clone), stop. Then:

```
git status --porcelain
```

The only entries allowed are ` M PLAN.md`, ` M CLAUDE.md`, ` M .gitignore`, `?? .claude/`
(Claude Code's own settings, untracked), and `??` lines for `*.patch` if they show. Anything
else: stop and record it. (The staged deletion of `public/arrowhead.svg` that stopped the first
run was undone in `48d0307`; it should not show.) Then:

```
git fetch origin
git checkout fix/map-legibility
git add PLAN.md CLAUDE.md .gitignore
git commit -m "Plan: the 2026-09-06 queue, resumed (steps 5f, 7, ship, 8, 2b, 9)"
git cherry-pick -x 25aaac1
git push
```

*(Amended after the first run, below: the tips had moved, so the fast-forward that stood here is
replaced by a cherry-pick.)* `25aaac1` (Step 6, the bike-type picker) is the only commit
`feat/bike-type` has that this branch lacks. It touches five files under `src/` and nothing
else; this branch since `6de9422` touches `PLAN.md` only; so the cherry-pick is conflict-free.
Rehearsed on the review side on `48d0307`: clean, and the whole patch chain then applies and
ends at 154 tests. The docs are committed first so the working tree is clean when the
cherry-pick runs. No rebase, no force-push; `feat/bike-type` is dead after this and is deleted
at item 3 as written. If the cherry-pick reports a conflict, `git cherry-pick --abort` and stop.

### Run 2026-09-06 — stopped at preflight, before any command in this item ran

Two things item 0 does not allow, found by its own checks:

1. `git status --porcelain` shows `D  public/arrowhead.svg`: the file is deleted on disk and the
   deletion is staged. It is not in the allowed list. It also blocks item 1 directly, because
   `step5f.patch` deletes that file itself and cannot apply a deletion to a file that is already
   gone. Nothing in this run removed it; the deletion was staged before the run began.
2. Local `fix/map-legibility` is `87b4cd9` ("Add Step 5f: the road lattice", 2026-09-05 02:24,
   PLAN.md only, never pushed), not `6de9422`. `feat/bike-type` (`25aaac1`) descends from
   `6de9422`, so `git merge --ff-only origin/feat/bike-type` refuses. Checked with
   `git merge-base --is-ancestor`, not by running the merge. Item 0 says: if it refuses, stop.

Nothing else was meant to be touched: no fetch, no checkout, no merge, no patch applied;
`.gitignore` and `CLAUDE.md` left as found, uncommitted. `git checkout -- .` was not run, because
it would have discarded the queue text itself. `041ff4b` carries this block and the queue text
PLAN.md already held.

**Correction, same run.** `041ff4b` also carries the staged deletion of `public/arrowhead.svg`:
after `git add PLAN.md`, a bare `git commit` commits the whole index, and the deletion was
already in it. That was the agent's error, not a decision. The file was restored from `87b4cd9`
in the commit that adds this paragraph; it is present at HEAD again and nothing is staged, so
item 1's patch can delete it as written.

To resume: the arrowhead file needs nothing further. Decide how `feat/bike-type` joins this
branch now that the tips differ: `git rebase fix/map-legibility` on `feat/bike-type` (the commits between them are
PLAN.md-only, so it is clean) and then the fast-forward as written, or a `--no-ff` merge instead
of it. Item 0's `--ff-only` line refuses until one of those is done. Then rerun from item 0.

**Resumed 2026-09-06 (reviewer).** Both findings correct; the stop was the right call, and the
correction commit was the right repair. Neither of the two options above is taken: a rebase
needs a force-push of `feat/bike-type`, which the rules forbid, and a merge commit adds a knot
for one code commit. Item 0 now cherry-picks `25aaac1` instead (amended in place above, with
the reasoning). Rerun from item 0.

### 1 — Step 5f

```
git apply --3way step5f.patch
rm step5f.patch
npm run check
npm run build
git add -A
git commit -m "Step 5f: the road lattice"
git push
```

Expect **141 tests**. Then under "Step 5f" above add `### Completed 2026-09-06 — commit <hash>`
with the test count; commit as `Record Step 5f`; push.

### 2 — Step 7

```
git apply --3way step7.patch
rm step7.patch
npm install
npx playwright install chromium
npm run check
npm run build
npm run shots -- step7
```

`npm install` writes `playwright` into the lockfile from the `package.json` the patch changed;
`npx playwright install chromium` downloads the browser the harness drives (one time, about
150 MB, into the user's cache, not the repo). `npm run shots` must end with `PASS` **and**
`docs/renders/step7/report.md` must say `Basemap: loaded from CARTO`. If it says NOT loaded, stop:
the machine has no internet and nothing visual can be trusted. Expect 141 tests. On PASS:

```
git add -A
git commit -m "Step 7: screenshot harness"
git push
```

`git add -A` takes `package.json`, `package-lock.json`, the scripts, `App.tsx` and
`docs/renders/step7/report.md`; the PNGs are ignored. Add the Completed block under Step 7 with
the arrow counts from `report.md`; commit as `Record Step 7`; push.

### 2b — Step 5g, the lattice drawn whole (added 2026-09-06, before the ship)

```
git checkout fix/map-legibility
git apply --3way step5g.patch
rm step5g.patch
npm run check
npm run build
npm run shots -- step5g
git add -A
git commit -m "Step 5g: the lattice drawn whole"
git push
```

Expect **145 tests** and, in `docs/renders/step5g/report.md`, `PASS` with the basemap loaded
and arrow counts within a few percent of Step 5g's numbers above (2591 at 17.5, 4101 at 18.5).
Completed block under Step 5g, `Record Step 5g`, push. This goes into the ship below, so the
production update carries it.

### 3 — Ship: `fix/map-legibility` → `main`

Steps 1–7 go to production together. The gate is item 2's PASS on this machine plus the same
checks on the merged tree:

```
git fetch origin
git checkout -B main origin/main
git merge --no-ff fix/map-legibility -m "Merge fix/map-legibility: steps 1-7 (ranker, canyon boundary layer, scale, panel, lattice, bike types, harness)"
npm run check
npm run build
npm run shots -- ship
```

*(Amended after the second run, recorded below.)* `git checkout -B main origin/main` points local
`main` at the remote, dropping the one unpushed PLAN.md-only commit it carried (`8f54f73`,
2026-09-03), whose edit the branch already holds — DJ's decision, 2026-09-06. It works from any
branch, including `main` itself. Rehearsed on the review side on `a7a0dfd` + `ed07701`: the merge
is clean, 141 tests, build clean. Production is **https://cph-wind.vercel.app** (Vercel project
`cph-wind`; the `main` branch alias is `cph-wind-git-main-djboy26s-projects.vercel.app`); quote
it in the report after the push.

Expect **145 tests** on the merged tree (Step 5g included). `main` carries only the bot's
`chore: wind-validation sample` commits since `630df8e`; they touch
`validation-log.ndjson`, which no step touches, so the merge is conflict-free. If it is not,
`git merge --abort` and stop. On green and `PASS`:

```
git add docs/renders/ship/report.md
git commit -m "Record ship renders"
git push origin main
git push origin --delete feat/route-panel-redesign feat/bike-type
```

Pushing `main` deploys production. `feat/route-panel-redesign` is a strict subset of the merged
branch (verified 2026-09-04) and `feat/bike-type` was fast-forwarded into it at item 0; both are
dead. Under this heading add `### Shipped 2026-09-06 — merge <hash>`; commit as `Record ship`;
push. If `gh` is installed and signed in (`gh auth status` exits 0), open the PR *before* the
merge — `gh pr create --base main --head fix/map-legibility --title "Steps 1-7" --body "See
PLAN.md, The queue, item 3."` — merge it with `gh pr merge --merge`, then `git checkout main &&
git pull` and run the merged-tree checks there; the record and the branch deletions are the same.

### Run 2026-09-06 — stopped at `git pull --ff-only origin main`, before the merge

`git checkout main` succeeded; `git pull --ff-only origin main` refused ("Not possible to
fast-forward, aborting"). Local `main` is `8f54f73` ("Restructure Step 4 as panel-only; add
Step 5 for map legibility", 2026-09-03 14:27, PLAN.md only, never pushed): one commit past
`d46c000`, which is also where `fix/map-legibility` forks from `main`. `origin/main` is
`a7a0dfd`: twenty bot commits (`chore: wind-validation sample [skip ci]`) past `d46c000` and
nothing else, exactly as this item expects. Each tip has commits the other lacks, so there is no
fast-forward.

Item 2 finished in full before this (`ef45854` Step 7, `90c63f3` Record Step 7, both pushed).
Nothing in this run touched `main`'s history or the remote: no merge ran, so there is nothing to
abort; the tree is clean apart from the three unapplied patches and the step7 PNGs, which
`main`'s older `.gitignore` lists as untracked. `git checkout -- .` had nothing to revert. Items
4–6 not started. This block is committed on `fix/map-legibility`, where the queue lives; `main`'s
PLAN.md predates the queue.

What `8f54f73` is: `git cherry fix/map-legibility main` marks it patch-equivalent to a commit
already on the branch, and 68 of its 72 added lines are in the branch's PLAN.md verbatim — the
same edit, committed on `main` as well as on the branch that afternoon. Merging the branch into
this local `main` would conflict in PLAN.md (`git merge-tree` dry run, exit 1), so the refusal
spared the abort-and-stop the next paragraph of this item prescribes. Merging into `origin/main`
is clean (dry run, exit 0).

To resume: point local `main` at `origin/main` — from the branch, `git branch -f main
origin/main`; nothing of `8f54f73` is lost, the branch carries it — then rerun item 3 from its
first line. `--ff-only` is then a no-op and the merge is the clean one.

**Resumed 2026-09-06 (reviewer).** Diagnosis confirmed from the remote side and the merge
rehearsed clean. Item 3 now starts with `git checkout -B main origin/main` (amended in place
above), which is the same repair as `git branch -f` but also works while `main` is checked out.
Rerun from item 2b (Step 5g, the arrow lattice fix DJ asked for first), then item 3 onward.

### Shipped 2026-09-06 — merge `3598510`

`git fetch origin`; `git checkout -B main origin/main` put local `main` on `81c1e36` — the bot's
`chore: wind-validation sample` commits past `d46c000` and nothing else; `8f54f73` dropped, as
decided. `git merge --no-ff fix/map-legibility` at `6805283` was clean: merge `3598510`. On the
merged tree `npm run check` green, **145 tests**, the count the queue expects; `npm run
build` clean; `npm run shots -- ship` `PASS`, and `docs/renders/ship/report.md` says
`Basemap: loaded from CARTO.` No browser errors. Counts: opening view 4561 desktop / 1031 phone;
16.5 → 1901; 17.5 → 2591; 18.5 → 4101; 17.5 at pitch 40 → 3826; 17.5 phone → 1709;
the shared route planned 3 routes. The report was committed as `5a6c9fe` ("Record ship renders")
and `git push origin main` sent `5a6c9fe` up: production is **https://cph-wind.vercel.app**.
`feat/route-panel-redesign` and `feat/bike-type` deleted on origin. `gh` is not installed on this
machine, so no PR: the local-merge path, as the item allows.

### 4 — Step 8, the canyon vortex

```
git checkout -b feat/canyon-vortex main
git apply --3way step8.patch
rm step8.patch
npm run check
npm run build
npm run shots -- step8
git add -A
git commit -m "Step 8: vortex reversal in deep canyons"
git push -u origin feat/canyon-vortex
```

Expect **150 tests** (145 after the ship, plus 5). Completed block under Step 8, `Record Step 8`, push.

### 5 — Step 2b, routing on the canyon wind

```
git apply --3way step2b.patch
rm step2b.patch
npm run data:canyon
npm run check
npm run build
npm run shots -- step2b
git add -A
git commit -m "Step 2b: route on the canyon-modified wind"
git push
```

`npm run data:canyon` writes `public/data/canyon-by-way.json` from the committed tiles (expect
`36946 ways, 159201 pieces, 2.55 MB`); it is committed by the `git add -A`. Expect **155 tests**
and, in `docs/renders/step2b/report.md`, `canyonEdges 363142` on the panel-routes row (any
value above 300,000 passes; below that, stop). Completed block, `Record Step 2b`, push.

### 6 — Step 9, two lines of copy

```
git apply --3way step9.patch
rm step9.patch
npm run check
npm run build
npm run shots -- step9
git add -A
git commit -m "Step 9: hint and tooltip copy"
git push
```

Expect **158 tests**. Completed block, `Record Step 9`, push. Then, if `gh` works:
`gh pr create --base main --head feat/canyon-vortex --title "Steps 8, 2b, 9: canyon vortex, canyon routing, copy" --body "Physics change; needs eyes before merge. See PLAN.md."`
**Do not merge this PR.** Without `gh`, leave the branch pushed. The last line of the final
report is the PR URL or the branch name, and the report says which shots need a person's eyes:
a deep street under a cross wind (Step 8) and the route panel (Step 2b).

---

## Step 8 — The canyon vortex: reverse the ground-level cross flow in deep streets

The review of 2026-09-04 (table above) found one sign error: with the wind blowing across a deep
street (λ > 0.65, Oke's skimming regime) a vortex fills the canyon and the flow at rider height
runs *toward* the windward wall, opposite to the roof-level wind, at about 0.2–0.3 of the
roof-level speed (Kastner-Klein & Rotach 2004, wind-tunnel canyon at λ = 1; Soulhac et al. 2008
for the oblique case, where the same vortex sits under the along-axis flow: helical flow). The
model shrinks the cross component toward zero and never reverses it. This step reverses it.
`src/math/index.ts` is the guarded file; this is the deliberate, designated change to it.

`step8.patch` is the implementation. **What it changes** in `canyonModifiedWind()`: the line

```ts
const crossFactor = Math.max(0.05, Math.exp(-1.8 * lambda));
```

becomes

```ts
const VORTEX_CROSS = -0.4;
const t = smoothstep(0.5, 0.8, lambda);
const crossFactor = (1 - t) * Math.max(0.05, Math.exp(-1.8 * lambda)) + t * VORTEX_CROSS;
```

with a module-level `smoothstep(a, b, x)` (0 below a, 1 above b, the cubic `u²(3 − 2u)`
between). Why −0.4: the reversed ground flow is ~0.25 of roof level; roof level ≈ the 10 m wind
here (H ≈ 15–20 m, z₀ = 0.03 m), and the cross component the factor multiplies is already
0.6 × that, so −0.25 / 0.6 ≈ −0.4. Nothing else in the function changes: `alongFactor`, the 0.6
applied once, the λ < 0.1 early return, the gust scaling and the direction reconstruction are
as they were. The along-canyon factor is untouched because the vortex sits under the channelled
flow; it does not replace it. The energy budget holds: |crossFactor| ≤ 0.41, alongFactor ≤ 1.45,
so speed ≤ 0.6 × 1.45 × ambient.

**Values** (cross factor on the rider-height cross component v = 0.6 U): λ = 0.3 → +0.58
(unchanged); 0.5 → +0.41 (unchanged, t = 0); 0.6 → +0.15; 0.63 → +0.03; 0.65 → −0.05 (the
flip); 0.7 → −0.22; 0.8 and above → −0.40. A 4.4 m/s wind straight across a λ = 1 street: today
4.4 × 0.6 × 0.165 = 0.44 m/s toward the leeward wall; after, 4.4 × 0.6 × 0.4 = 1.06 m/s toward
the windward wall. Shelter band 24 % of ambient, still "Deeply sheltered": only the arrow's
direction changes. Routing sees nothing of it (the cross component projects to zero on the
street axis; Step 2b relies on that).

**Tests** — `describe('canyonModifiedWind — vortex (step 8)')` appended to
`src/math/index.test.ts`; street bearing 0, ambient 8 m/s, v = 4.8:

1. λ = 1, wind from 90°: direction within 1° of 270, speed 4.8 × 0.4 = 1.92 within 1e-9.
2. λ = 0.3, wind from 90°: direction within 1° of 90, speed 4.8 × e^(−0.54) within 1e-9.
3. λ = 0.5, wind from 90°: 4.8 × e^(−0.9) within 1e-9 (continuity at the blend's foot).
4. λ = 1.2, wind from 45°: along = −v/√2 × 1.36, cross = −v/√2 × (−0.4); speed = √(along² +
   cross²) = 4.8115 within 1e-6, direction from 343.6° within 0.1°. Written as the arithmetic.
5. Continuity: λ from 0.30 to 1.20 in 0.01 steps, wind from 90°; the x-component of the travel
   vector changes by < 0.25 m/s between neighbours (the blend's steepest slope gives ~0.19; a
   hard flip would be ~2).
6. Every existing test passes, including the energy budget over λ ≤ 2.5. One existing test is
   amended, not deleted: `computeSegmentLanes › asymmetric canyon: edge lanes differ from center`
   compared the two edge lanes' *speeds* (λ 1.53 and 0.47 by the lane-local geometry); after the
   reversal the speeds happen to agree (2.40 vs 2.59 m/s) while the directions oppose, so it now
   compares the two flow vectors (|Δ| > 0.5 m/s). The lane functions are not used by the app
   since 5f (only `computeSegmentCenterWind` is); the test is kept for the maths.

**Copy** — `About.tsx`: "wind flowing along the street speeds up, wind across it dies down, and
in a deep street it turns back on itself near the ground".

### Completed 2026-09-06 — commit `eb391ed`, branch `feat/canyon-vortex`

Branched from `main` at `614651b` (`Record ship`, the tip after the merge). Applied with `git apply --3way step8.patch`, clean:
`src/math/index.ts` (the designated change to the guarded file), its tests, `About.tsx`. The
patch file was deleted before the commit and never committed. `npm run check` green,
**150 tests** (145 after the ship, plus 5). `npm run build` clean. `npm run shots -- step8`
ended `PASS`; `docs/renders/step8/report.md` says `Basemap: loaded from CARTO.` No browser errors.
Arrow counts: opening view 4561 desktop / 1031 phone; 16.5 → 1901; 17.5 → 2591;
18.5 → 4101; 17.5 at pitch 40 → 3826; 17.5 phone → 1709 — the same seven numbers as Step 5g, as the lattice does not depend on the wind. The shared route
planned 3 routes. Pushed with `-u`.

Changed beyond the patch: nothing.

For a person: a deep street under a cross wind. In `docs/renders/step8/` on this machine, the
`nw9` set (9 m/s from 300°) at 18.5 on the boulevard is the one to look at — in the deep side
streets the arrows should now point toward the windward wall, against the roof-level wind — and
then the same street on the branch preview before the merge.

---

## Step 2b — second spec (2026-09-06): route on the canyon-modified wind

The 2026-09-03 note above asked for a human decision on the join. Decided: the graph gets a
per-way table of canyon geometry keyed the way the pipeline already keys pieces (`wayId`,
`startM`), derived from the committed tiles, so no Overpass call and no untracked file is
involved. It is option 2's outcome (one source for arrows and routing) at option 3's cost.
`step2b.patch` is the implementation; measured on the review side on real data.

**1. The table** — `scripts/canyon-by-way.mjs`, `npm run data:canyon`. Reads
`public/data/segtiles/index.json` and every tile it lists (fields by name from the manifest)
and writes `public/data/canyon-by-way.json`:

```
{ "<wayId>": [[startM, heightM, widthM], …sorted by startM], … }
```

`heightM = (leftH + rightH) / 2`, `widthM = leftDist + rightDist`, both rounded to 0.1, keys
`String(wayId)` (the roads file's numeric `id`). 36,946 ways, 159,201 pieces, 2.55 MB.
Committed; the app fetches it.

**2. The graph** — `routing/graph.ts`: `Edge` gains `canyon?: CanyonGeometry`;
`buildGraph(roads, canyonByWay?)` keeps the cumulative distance from the way's first node while
walking its coordinates and, for each edge, takes the piece with the largest `startM ≤` the
edge's midpoint distance (a forward scan; pieces are sorted). Both directed edges of a pair share
one `{ heightM, widthM }` object per piece. A way absent from the table leaves `canyon`
undefined. `RoutingGraph` gains `canyonEdges`. The pipeline's along-way distance uses a fixed
metres-per-degree at the city latitude and the graph's uses each edge's mean latitude; they
differ by under 0.5 %, well inside a 30 m piece.

**3. The wind on an edge** — `routing/windRoute.ts`, `edgeHeadwind` now:

```ts
const w = canyonModifiedWind(edge.bearingDeg, edge.canyon ?? OPEN, wind); // OPEN: heightM 0
// headwind = −(travel vector of w · street unit vector); no streetLevelWind here — the
// canyon path already applied the 0.6 once.
```

`resistance` is no longer imported there. `effectiveSpeed`, `edgeTimeS`, `routeMetrics`,
`planRoutes` are unchanged and pick this up. On a channelled street a headwind is now up to
45 % stronger than the flat model said, and so is a tailwind; a cross wind still costs nothing.

**4. Loading** — `routingWorker.ts`: `InitMsg.canyon?`, `ReadyOut.canyonEdges`. `App.tsx`
fetches `/data/canyon-by-way.json` in the idle callback that fetches the roads and posts `init`
once both have answered; if the table fails to load it warns and routes on the flat model.
`window.__cphwind.canyonEdges` carries the count; the harness records it on the panel-routes
row.

**Tests** — `routing/canyonJoin.test.ts`: (1) a synthetic 90 m way in three pieces with
heights 5 / 20 / 5 over width 10 attaches λ 0.5 / 2 / 0.5 and `canyonEdges` = 6; (2) a way
absent from the table has `canyon` undefined and `edgeHeadwind` equals
`resistance(bearing, wind).headwindMs` within 1e-9 for wind from 0°, 45°, 90°, 225° — this pins
"the 0.6 exactly once"; (3) λ = 1 heading north, wind from the north at 5 m/s: 5 × 0.6 × 1.3 =
3.9 forward, −3.9 back; (4) same edge, wind from the east: 0 within 1e-9; (5) the committed table
parses, has > 30,000 keys, and every way's rows are sorted by `startM`.

**Measured on real data** (review side, 2026-09-06): 365,000 directed edges, 363,142 with a
canyon (99.5 %). The shared route Nørreport → Islands Brygge at 4.4 m/s from 240°: wind cost
46 / 51 / 51 s on the flat model, 56 / 62 / 69 s on the canyon model, and a fourth option
appears (9.17 min, 2.47 km). Seconds, not minutes, as expected.

### Completed 2026-09-06 — commit `744d387`, branch `feat/canyon-vortex`

Applied with `git apply --3way step2b.patch` on `698df25` (Record Step 8), clean. The patch file
was deleted before the commit and never committed. `npm run data:canyon` wrote
`public/data/canyon-by-way.json` from the committed tiles: `36946 ways, 159201 pieces, 2.55 MB` (the item expects
36946 ways, 159201 pieces, 2.55 MB); the table is in the step commit. `npm run check` green,
**155 tests**. `npm run build` clean. `npm run shots -- step2b` ended `PASS`;
`docs/renders/step2b/report.md` says `Basemap: loaded from CARTO.` No browser errors. The panel-routes
row carries `canyonEdges 363142` (the queue expects 363142; the gate is above 300,000). The
shared route Nørreport → Islands Brygge planned 4 routes, canyonEdges 363142; the panel read: 9 min / 2.47 km / +56 s into the wind / 9 min / 2.46 km / +1 min 2 s into the wind / 11 min / 2.82 km / +1 min 9 s into the wind / 11 min / 2.87 km / +1 min 16 s into the wind. Pushed.

Changed beyond the patch: nothing but the generated table the step asks for.

For a person: the route panel — the options and their wind costs under the canyon model, from
the branch preview; `panel-routes.png` in `docs/renders/step2b/` on this machine meanwhile.

---

## Step 9 — Two lines of copy

`step9.patch`. (1) `OnboardingHint.tsx`: "Zoom in for wind on every street" → "Zoom in for
arrows on every street" — since 5e every street carries them; zooming makes them denser.
(2) The tooltip nit from the 2026-09-04 review: a 1.5 m/s along-street wind was labelled
"Neutral / crosswind". `windCategory.ts` gains `impactLabel(band, headwindMs)`: inside the
neutral band, |h| > 0.5 m/s reads "Light headwind" / "Light tailwind"; every other band keeps
its label; no band or colour changes, so the colour-collision gate is untouched.
`SegmentTooltip.tsx` uses it for both chips. Tests in `windCategory.test.ts`: 1.5 → "Light
headwind", −1.5 → "Light tailwind", 0.3 and −0.5 → "Neutral / crosswind", ±3 → the band's
own label.

### Completed 2026-09-06 — commit `fc58ea1`, branch `feat/canyon-vortex`

Applied with `git apply --3way step9.patch` on `3d18920` (Record Step 2b), clean. The patch file
was deleted before the commit and never committed. `npm run check` green, **158 tests**, the
count the queue expects. `npm run build` clean. `npm run shots -- step9` ended `PASS`;
`docs/renders/step9/report.md` says `Basemap: loaded from CARTO.` No browser errors. Counts: 17.5 →
2591; 18.5 → 4101; the shared route planned 4 routes, canyonEdges 363142. Pushed.

Changed beyond the patch: nothing. `gh` is not installed on this machine, so no PR was opened;
`feat/canyon-vortex` is pushed and left unmerged — a physics change, for eyes before merge.

---

## Merge order — revised 2026-09-06

1. `fix/map-legibility` (steps 1–7, with `feat/bike-type` fast-forwarded in) → `main`, by the
   queue's item 3, on the harness gate.
2. `feat/canyon-vortex` (steps 8, 2b, 9) → PR, left open. It changes what the arrows say in deep
   streets under a cross wind and what the router charges on channelled streets; DJ looks at the
   preview, the reviewer checks the renders, then it merges.

## Verification before merge

1. `npm run check` green. Never `npm test`.
2. `npm run build` clean.
3. `npm run shots -- <label>` PASS with the basemap loaded; `report.md` committed.
4. For the physics PR only: DJ's phone shots of a deep street under a cross wind, and the
   comparison against `wind-math-bench.html` on five named streets, are still a person's job.

## Out of scope

Junction continuity and upstream wakes (see Step 2b's first note). Validating the canyon model against ground truth. That needs DMI station data or manual anemometer
readings and is its own milestone. The meta description already claims "modified by urban canyon
channeling around buildings" — that claim needs a residual number behind it eventually, but not in
this change.
