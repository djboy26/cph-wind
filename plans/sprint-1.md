# Sprint 1: foundations

Opened 2026-10-08 from the technical review. The reasons and the choices behind it are in
`docs/decisions.md` (D1 to D4). Milestone 1's record moves to `docs/history/PLAN-M1.md` with
item 1.

Every patch below was built and verified on the review side against `main` at 04049a9: lint,
the full test suite, `npm run build` and the screenshot harness, on each branch in turn.

| item | what | arrives as | kind (D3) | tests after |
|---|---|---|---|---|
| 0 | Housekeeping: this plan, the decisions, the Milestone 2 draft | files already in place | unattended | 158 in 13 files (unchanged) |
| 1 | Hygiene and compliance | `s1-hygiene.patch` | unattended; two things need eyes | 164 in 14 files |
| 2 | Animation rewrite | `s1-animation.patch` | pull request with preview | 175 in 15 files |
| 3 | Data out of git, part 1: the lock | `s1-data.patch` | unattended | 191 in 19 files |
| 4 | Data out of git, part 2: the cutover | commands below | second pull request, after DJ's R2 setup | 191 in 19 files |

## How to run it

1. `git checkout main && git pull --ff-only`. On 2026-10-08 the laptop was 171 commits behind
   `origin/main`, every one of them the validation bot's `validation-log.ndjson`, so this is a
   fast-forward.
2. `git checkout -b sprint-1`.
3. Items 0 to 3 in order. Each patch was built on the one before it, so the order matters.
4. For each patch: `git apply --3way <patch>`, delete the patch file, run the item's commands,
   compare with its acceptance numbers, commit with the item named in the message, then add a
   `### Completed <date> — commit <hash>` block under the item (test count, harness numbers)
   and commit that as `Record Step <item>`.
5. Stop and report, without working around it, when a patch does not apply cleanly
   (`git checkout -- .`, then write it under the item here), a check fails, the harness says
   FAIL, or its report says the basemap was NOT loaded.
6. After item 3: `git push -u origin sprint-1`, open one pull request for items 0 to 3
   (`gh pr create`; if `gh` is not set up, give DJ the branch name) and give DJ the Vercel
   preview link from it. Do not merge. DJ merges after looking at what is listed under "Needs
   eyes" in items 1 and 2.
7. Item 4 starts only when DJ says `.r2.local` is in place, on a new branch from the merged
   `main`.

Items 0 to 3 are safe in auto mode up to opening the pull request.

## Item 0: housekeeping

`plans/sprint-1.md` (this file) and `docs/decisions.md` are already in the working tree.
`PLAN-2.md` and `docs/world/` are untracked.

```
mv PLAN-2.md plans/M2-world.md
```

Put this banner above the first line of `plans/M2-world.md`, then a blank line:

```
> **Status 2026-10-08: revise before starting.** Written 2026-09-06. `docs/decisions.md`
> supersedes parts of it: D1 (foundations first, so this milestone waits for Sprints 1 and 2)
> and D4 (Copenhagen's data leaves the repo as well, pinned by `data.lock.json`, so "Its data
> stays in the repo" no longer holds). Sprint 1 also adds `src/data/base.ts` with `dataUrl()`,
> which W1 extends instead of creating.
```

```
git add plans/sprint-1.md plans/M2-world.md docs/decisions.md docs/world/cities.csv docs/world/ranking.xlsx
git commit -m "Sprint 1 plan, decisions D1-D4, Milestone 2 draft (to be revised)"
```

Acceptance: `git status --short` shows nothing but `?? .claude/` (the patch files are gitignored).

### Completed 2026-10-09 — commit 93e506d

Branch `sprint-1` cut from `main` at 55e0327, a clean fast-forward of 172 bot commits from
1e57657. The patches' base, 04049a9, is an ancestor of that and only `validation-log.ndjson`
differs between the two, as this plan predicted.

158 tests in 13 files pass (`npm run test:run`) — the unchanged baseline. No harness run for this
item.

Acceptance met with one deviation: `git status --short` shows `?? cph-wind-status.md`,
`?? decisions.md` and `?? sprint-1.md` rather than nothing. Those are the reviewer's hand-off
copies delivered at the repo root — the root `sprint-1.md` is the pre-`:23`-cron draft of this
file and the root `decisions.md` is byte-identical to `docs/decisions.md`. The operator's
standing instruction is never to delete a hand-off file, so they stay untracked and unstaged.
`?? .claude/` does not appear; that directory holds only `settings.local.json` and is excluded
outside this repo's `.gitignore`.

## Item 1: hygiene and compliance (`s1-hygiene.patch`)

| finding | change |
|---|---|
| 5. DMI's old observation host is retired: the validation bot's last DMI sample is from 2026-09-07 (3,712 before it), while its METAR samples run to today | `scripts/validate-wind.mjs` queries `opendataapi.dmi.dk/v2` per station: 06180 Kastrup, 06181 Jægersborg |
| 5. Every hourly bot commit redeploys production (the live deployment on 2026-10-08 was built from bot commit 55e0327 and re-uploaded a 163.5 MB build cache) | `vercel.json` `ignoreCommand` skips commits that touch only `validation-log.ndjson`, `docs/`, `plans/` or Markdown |
| 5. The bot is scheduled on the hour (`0 * * * *`). GitHub delays and drops scheduled runs at the start of every hour, and about 5 of the 24 runs a day reached the log after 2026-09-07; MET Norway's terms also ask clients not to call on the hour | `validate-wind.yml` runs at :23 (`23 * * * *`). Pairing is unaffected: observations and forecasts are matched by their own timestamps |
| 9. The forecast proxy relays MET Norway for any coordinate on Earth under our User-Agent | `api/wind.ts` answers only inside 55.3 to 56.1 N, 12.0 to 13.1 E (400 outside), rounds to 0.01° so nearby riders share one cache entry, and serves the last forecast for an hour during a MET outage (`stale-if-error=3600`) |
| 3. The map credits are not on the map; CARTO's terms require CARTO and OpenStreetMap credited on every map | `src/components/Attribution.tsx`, always on screen |
| 15. Inter loads from Google's servers (each visit sends the visitor's IP to Google); `user-scalable=no` blocks page zoom (WCAG 1.4.4) | Inter is bundled through `@fontsource/inter`; the viewport allows zoom |
| 13. Node 20, 22 and 24 in different places; `npm test` was watch mode and hung agents | Node 24 in `.nvmrc`, `engines` and both workflows; `npm test` runs once, `test:watch` watches |
| 14. Dead files | 10 removed: `src/layers/computeArrows.ts`, `src/math/test.ts`, `src/math/index.html`, `src/App.css`, three files in `src/assets/`, `scripts/compute-canyons.mjs`, `scripts/diagnose-buildings.mjs`, `scripts/diagnose-osmtogeojson.mjs` |
| 12. `PLAN.md` is 145 KB and every agent reads it | moved to `docs/history/PLAN-M1.md`; `CLAUDE.md` points at the sprint plan |
| 8, in part. The data pipeline needed steps run by hand | `npm run data:rebuild` runs the whole chain |
| New. `package.json` listed the `deck.gl` umbrella, which the code never imports | removed; `@deck.gl/core` is a direct dependency at `~9.3.2`. That drops 287 packages (`@arcgis/core`, Esri's components, d3, turf, and a Vaadin usage-statistics package whose postinstall npm flags on every Vercel build); `node_modules` goes from 840 MiB to 382 MiB and the built bundle is byte-identical |

Commands:

```
git apply --3way s1-hygiene.patch && rm s1-hygiene.patch
npm ci                      # the lockfile changed
npm ls @arcgis/core         # must print (empty)
npm run check
npm run build && npm run shots -- s1-hygiene
```

Acceptance:

- 164 tests in 14 files pass; build green.
- Harness PASS with the arrow counts of `docs/renders/physics/report.md`, for both winds:
  city-desktop 5177, city-phone 1169, z16.5 2103, z17.5 3177, z18.5-boulevard 6708,
  z17.5-pitch40 4705, z17.5-phone 1709; panel-routes planned with canyonEdges 363142.
- The DMI host answers:
  `node -e "fetch('https://opendataapi.dmi.dk/v2/metObs/collections/observation/items?stationId=06180&parameterId=wind_speed&limit=1').then(r=>r.json()).then(j=>console.log(j.features.length, j.features[0].properties))"`
  prints `1` and an observation. Do not run `validate-wind.mjs` itself: it appends to the bot's log.
- After the item commit, the deploy filter sees code:
  `git diff --quiet HEAD^ HEAD -- . ':(exclude)validation-log.ndjson' ':(exclude)docs' ':(exclude)plans' ':(exclude)*.md'; echo $?`
  prints `1` (1 builds, 0 skips).
- After the merge, not before: two days later `validation-log.ndjson` on `main` should hold
  DMI rows again (stations 06180 and 06181) and close to 24 runs a day. Record the counts under
  this item.

Needs eyes, on the preview:

- The credit line sits bottom right on a desktop, just above the time slider on a phone, and at
  the top right while a route is being planned. It never covers the legend, the slider or a
  button.
- The text is still Inter, and the browser's network tab shows no request to
  `fonts.googleapis.com` or `fonts.gstatic.com`.

### Completed 2026-10-09 — commit 72dc995

`s1-hygiene.patch` applied with `git apply --3way` at exit 0, no conflict and no rejected hunk;
`git apply --3way --check` was run first and also passed. 29 files changed.

- `npm ci` from the new lockfile succeeded. `npm ls @arcgis/core` prints `(empty)`.
  `node_modules` is 329 MiB measured with `du -sh` here, against the 382 MiB recorded on the
  review side — a measurement difference, not a content one, and not an acceptance number.
- `npm run check`: lint clean, **164 tests in 14 files pass**. Matches.
- `npm run build` green. Inter ships as eight bundled files in `dist/assets/`
  (`inter-latin-{400,500,600,700}-normal` as `.woff2` and `.woff`), which is the build-side half
  of the Google-fonts finding.
- `npm run shots -- s1-hygiene`: **PASS**, `Basemap: loaded from CARTO`, `No browser errors`.
  Arrow counts equal the acceptance line exactly, for both winds — city-desktop 5177,
  city-phone 1169, z16.5 2103, z17.5 3177, z18.5-boulevard 6708, z17.5-pitch40 4705,
  z17.5-phone 1709; `panel-routes` planned 4 routes with canyonEdges 363142.
- DMI host: the acceptance one-liner prints `1` and an observation — station 06180,
  `wind_speed` 5.66, observed 2026-10-08T20:10:00Z. `validate-wind.mjs` itself was not run.
- Deploy filter after this commit: exit `1`, so Vercel builds it. Correct.

Two deviations from the written commands, neither affecting a result:

- Playwright had no browser on this machine at all (`ms-playwright/` did not exist), so the
  first harness run died on `Executable doesn't exist`. The operator's fallback
  `PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium` is a Linux sandbox path and does not exist
  here, so the fix was `CLAUDE.md`'s own documented first-run step,
  `npx playwright install chromium` (Chrome Headless Shell 153.0.8010.12, chromium-headless-shell
  v1243). The harness then ran as above.
- `rm s1-hygiene.patch` was **not** run. The operator's standing instruction for this session is
  never to delete a hand-off file, and `CLAUDE.md` calls the root `.patch` files exactly that.
  They are gitignored by `/*.patch`, so keeping them changes no acceptance check and leaves
  nothing uncommitted. The same applies to items 2 and 3.

Still open, by design: the two "Needs eyes" items above, and the post-merge DMI row count, which
cannot be recorded until two days after the merge.

## Item 2: animation rewrite (`s1-animation.patch`)

Finding 1. The arrows' brightness wave was computed on the CPU every frame. `useFlowPhase` set
React state 60 times a second (30 on phones), so all of `MapApp` re-rendered, and the arrow
layer re-ran `getColor` for every arrow through `updateTriggers: { getColor: time }` and
re-uploaded the colour buffer. A comment in `App.tsx` claimed the opposite.

The change:

- `WaveIconLayer` in `src/layers/FlowLineLayer.ts` (an `IconLayer` subclass) adds a per-arrow
  phase attribute and a uniform block `{cycle, depth}`. One line of GLSL at the end of the
  vertex shader scales the arrow's alpha by `(1 - depth) + depth * sin(2π(phase - cycle))`: the
  same formula as before, period 4 s, depth 0.15. The clock is reduced to one cycle in double
  precision before it reaches the GPU, so `sin()` never sees an argument beyond ±2π. A raw clock
  would reach 1.36 × 10⁵ rad after a day open, where 32-bit floats step by 1/64 rad.
- Per-arrow colour is static; no time-based update trigger remains.
- `src/hooks/useRedrawLoop.ts` raises the arrow layer's redraw flag at 60 frames a second (30 on
  phones). deck.gl folds that into frames it draws anyway, so a pan never draws twice.
- `src/hooks/useReducedMotion.ts`: with the system's reduce-motion setting on, the wave holds
  still at the arrows' base opacity.
- The harness reads back from deck.gl's picking buffer how many arrows the GPU actually drew
  (`drawn`), so a shader that fails to compile now fails the run. Two new checks: with
  reduce-motion on the page must come to rest and stay still; animating, two frames 2 s apart
  must differ.

Measured on the review side: headless Chromium with software GL, the z17.5 view, mocked wind,
each build served the same way, medians of three 12 s windows. Software GL presents under one
frame a second there, so these are costs per frame, not frame rates.

| per animation frame | before | after |
|---|---|---|
| React commits | 1.00 | 0 |
| deck.gl canvas clears, desktop | 2.00 | 1.00 |
| draw calls, desktop | 12 | 6 |
| WebGL buffer uploads, desktop 1440×900, 3,177 arrows | 62 calls, 105.6 KiB | 31 calls, 3.2 KiB |
| JavaScript time, desktop | 8.9 ms (runs 6.2, 8.9, 19.4) | 3.4 ms (runs 3.4, 26.9, 2.8) |
| JavaScript time, phone 390×844 at CPU ÷ 4, 1,709 arrows | 19.7 ms (runs 20.0, 15.8, 19.7) | 10.1 ms (runs 6.5, 13.1, 10.1) |

The clear and draw rows are the surprise. With a React update pushed into every frame on top of
deck.gl's own render loop, the old code cleared and drew the deck.gl canvas twice per frame; the
software renderer, which is bound by drawing, managed twice the frames once that stopped (8
against 4 in the same 15 s). The commit, clear, upload and draw counts are exact; the timings are
noisy and only show the direction.

Commands:

```
git apply --3way s1-animation.patch && rm s1-animation.patch
npm run check
npm run build && npm run shots -- s1-animation
```

Acceptance:

- 175 tests in 15 files pass; build green.
- Harness PASS. Arrow counts as in item 1. `drawn` is above 0 on every view; on the review side
  it was 2592 / 451 / 553 / 475 / 490 / 677 / 119 for the sw4 views in table order, and
  slightly different under nw9 because rotated arrows overlap differently.
- `wave-reduced-motion` reports frames identical and `wave-animating` frames differ.

Needs eyes, on the preview next to production (https://cph-wind.vercel.app):

- The wave looks the same: a soft brightening drifting downwind through the arrows, one cycle
  every 4 s.
- On DJ's phone the map pans and zooms smoothly while the wave runs.
- With Reduce Motion on (iPhone: Settings > Accessibility > Motion > Reduce Motion; Android:
  Settings > Accessibility > Remove animations) the arrows hold still. Turning it off brings the
  wave back without a reload.
- Desktop: hovering a street still shows its tooltip and clicking still pins it.

## Item 3: data out of git, part 1: the lock (`s1-data.patch`)

Finding 8. `public/data/` held 134.5 MiB in git. Every data rebuild added another copy to the
history, and every deployment shipped all of it, including `cph-buildings.json` (70.2 MiB of raw
footprints the app never fetches). D4 moves the data to R2. This item adds the machinery and
changes nothing for a build today: every pull below is a no-op while the committed files match
the lock.

- `data.lock.json`: version `5d464b01f465` (a hash of the contents), the size and SHA-256 of all
  164 files, no origin yet.
- `npm run data:pull` fetches the locked app data (163 files, 64.3 MiB) from the lock's origin
  and verifies every file. It never overwrites a local file that differs unless given `--force`,
  `--check` verifies offline, `--all` adds the pipeline inputs. `build` and `dev` run it first;
  `npm test` runs the check first; CI pulls with a cache per lock.
- `npm run data:lock` records local data as a version; `npm run data:publish` uploads it to R2
  under `<version>/<path>`, checks the public URL serves it, and writes the origin into the lock.
  The S3 signing uses `node:crypto` only. It reproduces AWS's three published SigV4 example
  signatures, and its PUT and HEAD headers were byte-identical to aws4fetch's, the client
  Cloudflare documents for R2.
- `cph-buildings.json` and the `cph-segments.json` intermediate move to `data/raw/`, outside the
  deployed folder; the pipeline scripts follow. `dist/` drops from 138 MiB to 67 MiB.
- `dataUrl()` in `src/data/base.ts` builds every map-data URL the app fetches.

Commands:

```
git apply --3way s1-data.patch && rm s1-data.patch
npm run data:check
npm run check
npm run build && npm run shots -- s1-data
```

Acceptance:

- `npm run data:check` prints `163 files match data.lock.json (version 5d464b01f465, 64.3 MiB)`.
  The Windows checkout converts line endings, but none of the data files contains a newline, so
  their bytes, and hashes, are the same as on Linux.
- 191 tests in 19 files pass; `npm run build` first prints `163 files already match data.lock.json`.
- Harness PASS with the numbers of item 2.
- `dist/` is about 67 MiB and has no `cph-buildings.json`.

## Item 4: data out of git, part 2: the cutover

### DJ's part, about 15 minutes, once

1. Cloudflare dashboard (dash.cloudflare.com, free account) > R2 object storage. Cloudflare may
   ask for a payment method before enabling R2. Usage here stays inside the free tier: 10 GB-month
   of storage, 1 million writes and 10 million reads a month, egress free. One data version is
   0.14 GB, a publish is about 330 requests, a build about 163.
2. Create bucket `cph-wind-data`. Keep the default jurisdiction (an EU jurisdiction changes the
   endpoint; the data is public OpenStreetMap material, so nothing requires it).
3. Bucket > Settings > Public Development URL > Enable, type `allow`, confirm. Copy the public
   URL, `https://pub-….r2.dev`.
4. R2 object storage > Account Details > API Tokens > Manage > Create Account API token.
   Permissions: Object Read & Write, applied to `cph-wind-data` only. Copy the Access Key ID and
   the Secret Access Key: the secret is shown once. The account ID is in the dashboard (the
   S3 endpoint is `https://<account id>.r2.cloudflarestorage.com`).
5. Create `.r2.local` in the repo root on the laptop. It is gitignored (`*.local`) and must
   never be committed or pasted anywhere:

   ```
   R2_ACCOUNT_ID=…
   R2_ACCESS_KEY_ID=…
   R2_SECRET_ACCESS_KEY=…
   R2_BUCKET=cph-wind-data
   R2_PUBLIC_URL=https://pub-….r2.dev
   ```

No Vercel setting and no CORS rule is needed: builds fetch the data, browsers keep loading it from
Vercel.

### The agent's part

```
git checkout main && git pull --ff-only && git checkout -b sprint-1-cutover
npm run data:publish
```

It must end with `published version 5d464b01f465: 164 uploaded (134.5 MiB)` and `data.lock.json
now points at https://pub-….r2.dev/5d464b01f465/`. Then:

```
git rm -r -q --cached public/data data/raw
```

Append to `.gitignore`:

```
# Map data: pinned by data.lock.json, fetched from R2 by npm run data:pull (docs/decisions.md D4)
/public/data/
/data/raw/
```

Delete this sentence from the "Data pipeline" section of `CLAUDE.md`: "Until the Sprint 1
cutover (`plans/sprint-1.md`) the files are also still committed." Then prove a clean checkout
works:

```
rm -rf public/data data/raw
npm run data:pull -- --all      # fetched 164 file(s), 134.5 MiB
npm run check
npm run build && npm run shots -- s1-cutover
git add .gitignore CLAUDE.md data.lock.json
git commit -m "Data out of git: public/data and data/raw come from R2, version 5d464b01f465"
git push -u origin sprint-1-cutover
```

Open a pull request. Acceptance:

- `git ls-files public/data data/raw` prints nothing.
- 191 tests in 19 files; harness PASS with the item 2 numbers.
- The pull request's Vercel build log shows `data: fetched 163 file(s), 64.3 MiB … from
  https://pub-….r2.dev`, and the preview draws arrows. That log line is the one thing only a
  real Vercel build can prove.

Needs eyes: the preview map opens and draws arrows like production. Nothing else changes.

The old copies stay in the history (about 32 MiB packed on the laptop). Rewriting it would need
a force-push to `main` and is not worth it.

## Not in this sprint

| finding | where it goes |
|---|---|
| 4. CARTO basemap terms (revised 2026-09-29: free access needs a CARTO key, keyless tiles may be watermarked, and from 2026-12-01 commercial use is capped at 1 million tiles a month) | Sprint 2, to finish before 2026-12-01: Protomaps on R2 (D2), a custom domain for the bucket, the credit line updated |
| 10. No error tracking | Sentry is wired (`src/monitoring.ts`) and stays off until `VITE_SENTRY_DSN` is set in Vercel. DJ creates the Sentry project and gives the go-ahead for the variable. Sprint 2 |
| 6. `App.tsx` is 1,100 lines with 26 state variables | later; it gets easier to split once the per-frame state is gone (item 2) |
| 7. One forecast point for the whole map | later, with Milestone 2's W4 |
| 2. Roads and the canyon table (2.7 MiB gzipped) load on every visit and are copied to the router worker | later: load on the first route request and transfer instead of copy |
| 16. One 939 kB JavaScript chunk | later: split the router and the 3D buildings off |
| 11. Test gaps | each sprint adds the tests for what it touches |
| New. The canyon model has never been checked against wind measured in a street; the log checks MET's 10 m forecast at masts | a measurement campaign, decided with DJ (anemometers at 1.5 to 2 m in contrasting streets, compared with the 10 m forecast × 0.6) |
| New. Vercel's Hobby plan is for non-commercial, personal use only | Vercel Pro before any commercial use |
| New. `README.md` is still the Vite template | Sprint 2 |
| New. The map data served to browsers is derived from OpenStreetMap, so it falls under ODbL | Sprint 2: state the licence and the attribution in the README and the About dialog |
| New. Photon's public geocoder is best-effort with no limits stated | self-hosted or paid geocoder before any marketing push |
| New. At z18.5 the field is built for 6,708 arrows and 490 are on screen | later: tighten the padded bounds at high zoom |
| New. `osmtogeojson` pulls `xmldom` 0.1.31 (CVE-2021-21366). Pipeline only, never in the bundle, and it is fed JSON, not XML | replace when the pipeline is next touched |

## Records

Each item's `### Completed <date> — commit <hash>` block goes under its heading above.
