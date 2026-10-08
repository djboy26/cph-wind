# Decisions

One entry per decision that changes how the project is built. Newest last. An entry is not
edited after the fact; a later decision supersedes it and says so.

## D1. Foundations before the world (2026-10-08)

**Context.** The technical review of 2026-10-08 (16 findings) found the animation recomputing
every arrow on the CPU and re-rendering React 60 times a second, 134.5 MiB of data in git (70.2 MiB
of it never fetched by the app), the map credits hidden, a retired DMI host, an open forecast proxy
and production redeploying on every hourly bot commit. Milestone 2 (`plans/M2-world.md`) would
multiply each of these by the number of cities.

**Options.** (a) Fix the foundations, then the world. (b) Start the world now and fix as we go.
(c) Both in parallel.

**Decision.** (a). Sprint 1 is hygiene and compliance, the animation rewrite and data out of git;
Sprint 2 is the basemap (D2). Milestone 2 starts after that, from a revised plan.

**Consequences.** `plans/M2-world.md` is kept as written on 2026-09-06 and marked for revision.
Two of its premises are already superseded: Copenhagen's data leaves the repo (D4), and
`src/data/base.ts` with `dataUrl()` exists (W1 builds on it rather than creating it).

## D2. Basemap: self-hosted Protomaps on Cloudflare R2 (2026-10-08)

**Context.** The map draws on CARTO's Positron style from CARTO's CDN. CARTO's terms (FAQ at
docs.carto.com/faqs/carto-basemaps, read 2026-10-08): free up to 5 million tile requests a month
for non-commercial use and 1 million for commercial use, then $500 a month for 10 million; CARTO
and OpenStreetMap must be credited on every map; vector styles load without a key today, but
CARTO asks for one. At a few dozen tiles per visit, 1 million requests is tens of thousands of
visits a month: enough for Copenhagen, not for the world or for any revenue.

**Options.** Self-hosted Protomaps (one PMTiles file in object storage, read by HTTP range
requests); a hosted vector-tile provider (MapTiler, Stadia) on a paid plan; staying on CARTO.

**Decision.** Self-hosted Protomaps on R2. Sprint 2.

**Consequences.** The style must be rebuilt to keep Positron's muted palette, which the arrow
colours were tuned against. The on-map credit changes from "© OpenStreetMap · © CARTO" to
"© OpenStreetMap · Protomaps" (`src/components/Attribution.tsx`). R2 is shared with D4. Serving
PMTiles to browsers is production traffic, so it needs a custom domain on Cloudflare and a CORS
rule: Cloudflare rate-limits the r2.dev URL and documents it for development only, and caching
works only through a custom domain.

## D3. Workflow: mixed (2026-10-08)

**Decision.** Mechanical changes (dependencies, scripts, tests, CI, data plumbing) run unattended
in Claude Code auto mode and land as commits on a sprint branch. Anything a person sees, or
anything that touches the wind physics, goes through a pull request with its Vercel preview link,
and DJ looks at the preview before it merges.

**Consequences.** Each sprint item in a sprint plan says which kind it is and lists what needs
eyes. The screenshot harness (`npm run shots`) stays the objective gate; the preview is the
subjective one.

## D4. Map data is versioned in object storage, not in git (2026-10-08)

**Context.** `public/data/` held 134.5 MiB, committed. Every data rebuild added another copy to the
history, and every Vercel deployment shipped all of it, including the 70.2 MiB of raw
building footprints the app never fetches.

**Decision.** The data lives in Cloudflare R2 under `<version>/<path>`. `data.lock.json`
(committed) names the version and the size and SHA-256 of every file; the version is a hash of
the contents. `npm run build` pulls the locked version into `public/data/` before building, so
the browser still fetches same-origin `/data/…` from Vercel: no CORS, no custom domain, no change
to how the app loads. Pipeline inputs live in `data/raw/`, outside the deployed folder.

**Consequences.** A clean checkout cannot build until the version in its lock has been published
(`npm run data:publish`), and the pull fails loudly rather than building on wrong data. Riders
never touch R2; only builds do, about 163 requests each. That is the development traffic the
bucket's rate-limited r2.dev URL is meant for, so this needs no custom domain. Serving data to
browsers straight from R2 (Milestone 2, W1) is a change to `dataUrl()`, a CORS rule and the
custom domain from D2. The history keeps the old copies (about 32 MiB packed on DJ's laptop);
rewriting it is not worth a force-push. Supersedes `plans/M2-world.md`'s "Copenhagen's data
stays in the repo".
