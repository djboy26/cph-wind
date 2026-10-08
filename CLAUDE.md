# cph-wind

Live per-street wind for Copenhagen cyclists. React 19 + Vite + deck.gl + MapLibre.
Wind from MET Norway Locationforecast through the `/api/wind` proxy (`api/wind.ts`); roads and
buildings from OpenStreetMap.

**Read `plans/sprint-1.md` (the current sprint) and `docs/decisions.md` before starting work.** The
sprint plan carries each item's diagnosis, its acceptance checks and whether it runs unattended or
goes through a PR with a preview link. Milestone 1's full record is `docs/history/PLAN-M1.md`; read
a step there only when the sprint plan points to it.

## Commands

| do this | not this |
|---|---|
| `npm run check` — lint + one-shot tests | ❌ `npm run test:watch` — watch mode, **hangs forever** |
| `npm test` (or `npm run test:run`) — one-shot tests | |
| `npm run build` — `tsc -b && vite build` | |
| `npm run dev` | |

`npm run test:watch` blocks indefinitely waiting for file changes. Never call it from an agent.
Node 24 everywhere (`.nvmrc`, `engines`, CI).

## Do not touch `src/math/index.ts` without reading this

`bearing()` and `resistance()` were cross-checked on 2026-09-03 against an independently written
oracle over 25,920 street-orientation × wind-direction pairs. Max disagreement: **5.7 × 10⁻¹⁴ °** for
bearing, **4.1 × 10⁻¹⁵ m/s** for resistance.

- The `cos(mean latitude)` scaling in `bearing()` is correct and necessary. Do not "simplify" it.
- `(directionDeg + 180) % 360` is the meteorological → travel-vector conversion. Correct.
- `headwindMs` is **positive for headwind**. This is the opposite of the usual physics convention and
  it is deliberate. Do not flip it.
- Tests in `math/index.test.ts` pin all of this. If one fails, the change is wrong, not the test.
  That rule is about the maths. A test that pins dead code goes when the code goes.

The defect once documented here (`streetLevelWind()` not applied inside `canyonModifiedWind()`)
was fixed by Step 2a on 2026-09-03 (`docs/history/PLAN-M1.md`).

## Conventions

- Bearings: degrees clockwise from north, `[0, 360)`.
- Wind direction is **meteorological** — the direction wind comes FROM. Always convert through
  `(directionDeg + 180) % 360` before comparing against a travel bearing.
- Speeds are **m/s internally**. MET returns m/s; if a source is ever added that does not, convert
  at the API boundary in `src/api/weather.ts` and never let km/h past it.
- `λ` (lambda) always means canyon aspect ratio H/W.
- Tabular numerals (`NUM` in `components/ui.ts`) on every live number so values don't jitter.

## Data pipeline

Regenerating map data hits Overpass hard and takes minutes. Do not run it unless a step says to.

```
npm run data:rebuild    # fetch-osm -> fetch-buildings -> compute-cross-sections -> tile-segments -> canyon-by-way -> slim-buildings
npm run data:validate
```

Generated artefacts in `public/data/` are committed, except `cph-segments.json`, which is an intermediate that `tile-segments` and the validator read; regenerate it locally with `node scripts/compute-cross-sections.mjs`. `segtiles/` is the tiled form the app loads. `canyon-by-way.json` is the per-way canyon table the router joins on (Step 2b), rebuilt from the tiles by `npm run data:canyon`.

## Rendering: `npm run shots`, and nothing else

You cannot look at this app from here, and you do not need to. The one sanctioned way to render
it is the screenshot harness (`docs/history/PLAN-M1.md`, Step 7):

```
npm run build && npm run shots -- <label>     # -> docs/renders/<label>/report.md + PNGs
```

It serves `dist/` itself, drives headless Chromium with the wind mocked, opens fixed views by URL
hash, and **fails** when a view draws no arrows, a shared route is not planned, or the page
throws. `report.md` is committed (the PNGs are ignored and stay on this machine for the
reviewer); quote its numbers in the step's Completed block. The first run needs
`npx playwright install chromium` once. If `report.md` says the basemap was NOT loaded, the
machine is offline and the pictures prove nothing — stop.

Do not start a dev server, do not `vite preview`, do not open a browser by any other route:

- The shell's working directory resets after every command, so `cd` does not persist. The
  browser preview launcher resolves `launch.json` from wherever the shell lands, which is not
  this repo; it has already started an unrelated project's dev server once.
- The harness answers "is it drawn?" objectively. Whether it *looks* right is still judged by a
  person from the Vercel preview or production; say in your report which shots need eyes.

Never write into another project's config to work around any of this.

## Patches at the repo root

`<step>.patch` files at the repo root are the reviewer's hand-off: the implementation of a step,
built and verified on the review side. Apply with `git apply --3way <step>.patch`, delete the
file, run the checks, commit. They are gitignored and never committed. If one does not apply
cleanly, do not resolve it by hand: `git checkout -- .`, record it in the sprint plan, stop.

## Working style

- Commit at each item boundary in the sprint plan, with the item named in the message.
- Record each item under its heading in the sprint plan (`### Completed <date> — commit <hash>`, test
  count, the harness numbers) and commit that as `Record Step <n>`.
- `npm run check` and `npm run build` must both pass before any commit.
- A GitHub Action pushes `chore: wind-validation sample [skip ci]` to `main` every few hours. Rebase
  rather than merge when it conflicts; it only touches data files. Vercel skips building commits
  that touch only that log, docs or Markdown (`ignoreCommand` in `vercel.json`).
- Pushing to `main` deploys straight to production. Work on a branch and open a PR.
- If a step cannot be completed, stop and report. Do not work around it. A half-applied change to the
  wind model is worse than no change, because the current state is at least self-consistent within
  each half of the app.
