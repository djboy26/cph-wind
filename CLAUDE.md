# cph-wind

Live per-street wind for Copenhagen cyclists. React 19 + Vite + deck.gl + MapLibre.
Data from Open-Meteo (wind) and OpenStreetMap (roads, buildings).

**Read `PLAN.md` before starting work.** It carries the current milestone, the diagnosis behind each
change, and the regression tests each step must satisfy.

## Commands

| do this | not this |
|---|---|
| `npm run check` — lint + `vitest run` | ❌ `npm test` — bare `vitest`, **watch mode, hangs forever** |
| `npm run test:run` — one-shot tests | |
| `npm run build` — `tsc -b && vite build` | |
| `npm run dev` | |

`npm test` will appear to succeed and then block indefinitely waiting for file changes. Never call it.

## Do not touch `src/math/index.ts` without reading this

`bearing()` and `resistance()` were cross-checked on 2026-09-03 against an independently written
oracle over 25,920 street-orientation × wind-direction pairs. Max disagreement: **5.7 × 10⁻¹⁴ °** for
bearing, **4.1 × 10⁻¹⁵ m/s** for resistance.

- The `cos(mean latitude)` scaling in `bearing()` is correct and necessary. Do not "simplify" it.
- `(directionDeg + 180) % 360` is the meteorological → travel-vector conversion. Correct.
- `headwindMs` is **positive for headwind**. This is the opposite of the usual physics convention and
  it is deliberate. Do not flip it.
- Tests in `math/index.test.ts` pin all of this. If one fails, the change is wrong, not the test.

The one known defect in this file is documented as its own step in `PLAN.md`
(`streetLevelWind()` is not applied inside `canyonModifiedWind()`). Fix it there, deliberately, with
the tests that step specifies. Do not fix it opportunistically while doing something else.

## Conventions

- Bearings: degrees clockwise from north, `[0, 360)`.
- Wind direction is **meteorological** — the direction wind comes FROM. Always convert through
  `(directionDeg + 180) % 360` before comparing against a travel bearing.
- Speeds are **m/s internally**. Open-Meteo returns km/h; convert at the API boundary in
  `src/api/weather.ts` and never let km/h past it.
- `λ` (lambda) always means canyon aspect ratio H/W.
- Tabular numerals (`NUM` in `components/ui.ts`) on every live number so values don't jitter.

## Data pipeline

Regenerating map data hits Overpass hard and takes minutes. Do not run it unless a step says to.

```
npm run data:rebuild    # fetch-osm -> fetch-buildings -> compute-cross-sections
npm run data:validate
```

Generated artefacts in `public/data/` are committed. `segtiles/` is the tiled form the app loads.

## Working style

- Commit at each step boundary in `PLAN.md`, with the step named in the message.
- `npm run check` and `npm run build` must both pass before any commit.
- A GitHub Action pushes `chore: wind-validation sample [skip ci]` to `main` every few hours. Rebase
  rather than merge when it conflicts; it only touches data files.
- Pushing to `main` deploys straight to production. Work on a branch and open a PR.
- If a step cannot be completed, stop and report. Do not work around it. A half-applied change to the
  wind model is worse than no change, because the current state is at least self-consistent within
  each half of the app.
