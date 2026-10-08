// scripts/shots.mjs — the screenshot harness.
//
//   npm run build && npm run shots -- <label>
//
// Serves dist/ on a local port, opens it in headless Chromium (Playwright) with the
// wind mocked to a fixture, and writes PNGs plus a report.md to docs/renders/<label>/.
// The basemap loads from CARTO as in production, so the pictures are what a person
// would see. Every view is fixed by URL hash (#z=…&lat=…&lon=…), so two runs of the
// same commit differ only in what the code draws.
//
// The run FAILS (exit 1) when a page throws, when a view that must show arrows builds
// none or the GPU draws none of them (both read from window.__cphwind, the probe App.tsx
// exposes; the GPU count comes back from deck.gl's picking buffer, so a broken arrow
// shader fails the run), or when the arrows' brightness wave does not move, or the map
// does not hold still with the operating system's reduce-motion setting on. It does not
// fail on basemap tile errors — those are reported, because a machine without internet
// access still gets useful pictures of the app's own layers.
//
// This is the one sanctioned way to look at the app from a machine that cannot open a
// browser: no dev server, no launch.json, nothing outside this repo.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serveDist } from "./shots/serve.mjs";
import { metFixture, PLACES } from "./shots/fixture.mjs";

const label = process.argv[2] ?? "latest";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "renders", label);
await mkdir(outDir, { recursive: true });

const ONBOARDED_KEY = "cphwind.onboarded.v1"; // OnboardingHint.tsx

// Views. H.C. Andersens Boulevard at Rådhuspladsen for the street shots — a wide
// arterial with cycle tracks both sides, in the centre so its tiles always exist.
// `arrows` is the minimum arrow count the view must draw; the field starts at zoom 13,
// so the opening views must draw some, and street views must draw a lattice.
const HCA = { lat: 55.6754, lon: 12.5687 };
const VIEWS = [
  { name: "city-desktop", hash: "", vp: [1440, 900], arrows: 200 },
  { name: "city-phone", hash: "", vp: [390, 844], mobile: true, arrows: 50 },
  { name: "z16.5", hash: `z=16.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`, vp: [1440, 900], arrows: 200 },
  { name: "z17.5", hash: `z=17.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`, vp: [1440, 900], arrows: 200 },
  { name: "z18.5-boulevard", hash: `z=18.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`, vp: [1440, 900], arrows: 100 },
  { name: "z17.5-pitch40", hash: `z=17.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=40`, vp: [1440, 900], arrows: 200 },
  { name: "z17.5-phone", hash: `z=17.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`, vp: [390, 844], mobile: true, arrows: 60 },
];
const WINDS = [
  { tag: "sw4", speed: 4.4, dir: 240, gust: 7 },
  { tag: "nw9", speed: 9, dir: 300, gust: 14 },
];

const server = await serveDist(join(root, "dist"));
const base = `http://127.0.0.1:${server.port}`;
// PW_EXECUTABLE_PATH lets a sandboxed reviewer point Playwright at a preinstalled Chromium.
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
const errors = [];
const report = [];
let failed = false;

async function openPage(wind, vp, mobile, { onboarded = true, reducedMotion = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: vp[0], height: vp[1] },
    deviceScaleFactor: 1,
    reducedMotion: reducedMotion ? "reduce" : "no-preference",
    isMobile: !!mobile, hasTouch: !!mobile,
    userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1" : undefined,
  });
  // The one-time onboarding hint is seeded as already dismissed, except for the shot
  // that is of the hint. Clicking "Got it" from a script is flaky under a pitched map.
  if (onboarded) await ctx.addInitScript((k) => { try { localStorage.setItem(k, "1"); } catch { /* ignore */ } }, ONBOARDED_KEY);
  await ctx.route("**/api/wind**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metFixture(wind)) }));
  await ctx.route(/photon\.komoot\.io|sentry|vercel-insights|vercel-analytics/, (r) => r.abort());
  const page = await ctx.newPage();
  const basemap = { ok: 0, failed: 0 };
  page.on("response", (r) => { if (/cartocdn\.com/.test(r.url())) basemap[r.ok() ? "ok" : "failed"]++; });
  page.on("requestfailed", (r) => { if (/cartocdn\.com/.test(r.url())) basemap.failed++; });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/insights|_vercel|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
  return { ctx, page, basemap };
}

const probe = (page) => page.evaluate(() => window.__cphwind ?? null);

/**
 * Screenshot through CDP rather than page.screenshot(): Playwright's wrapper waits on
 * animation frames and times out on a software renderer where deck.gl runs at a
 * frame a second; the raw capture returns the same pixels at once.
 */
async function snap(page, path) {
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  await cdp.detach();
  const png = Buffer.from(data, "base64");
  if (path) await writeFile(path, png);
  return png;
}

/** Arrows the GPU drew in the current frame (null on a build without the probe). */
const drawnArrows = (page) => page.evaluate(() => window.__cphwind?.drawnArrows?.() ?? null);

/** Wait until the probe reports at least `min` arrows, or the deadline passes. */
async function waitForArrows(page, min, ms = 30_000) {
  const t0 = Date.now();
  let p = null;
  while (Date.now() - t0 < ms) {
    p = await probe(page);
    if (p && p.arrows >= min) return p;
    await page.waitForTimeout(500);
  }
  return p;
}

function record(name, p, basemap, want, drawn = null) {
  const arrows = p?.arrows ?? 0;
  const ok = want === 0 || (arrows >= want && drawn !== 0);
  if (!ok) failed = true;
  report.push({ name, ok, arrows, drawn, want, zoom: p?.zoom ?? null, tiles: p?.tiles ?? null, basemap });
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(28)} arrows=${String(arrows).padStart(5)} (min ${want})  drawn=${drawn ?? "?"}  tiles=${p?.tiles ?? "?"}  basemap ${basemap.ok} ok / ${basemap.failed} failed`);
}

for (const wind of WINDS) {
  for (const v of VIEWS) {
    const { ctx, page, basemap } = await openPage(wind, v.vp, v.mobile);
    await page.goto(`${base}/#${v.hash}`, { waitUntil: "networkidle", timeout: 90_000 });
    const p = await waitForArrows(page, v.arrows);
    await page.waitForTimeout(2500); // basemap tiles and the building layer stream in after the field
    await snap(page, join(outDir, `${v.name}-${wind.tag}.png`));
    record(`${v.name}-${wind.tag}`, p, basemap, v.arrows, await drawnArrows(page));
    await ctx.close();
  }
}

// The arrows' brightness wave (sprint 1: it runs in the arrow shader). Reduce-motion first:
// the page must come to rest (two frames 1 s apart identical, within 20 s) and stay at rest
// for 2 s, which proves nothing else on the map moves once loaded. Then, animating, after the
// same time to rest plus a second, two frames 2 s apart must differ: only the wave can do that.
async function restingFrame(page, ms = 20_000) {
  let prev = await snap(page);
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    await page.waitForTimeout(1000);
    const next = await snap(page);
    if (next.equals(prev)) return next;
    prev = next;
  }
  return null;
}
let restMs = 2500;
for (const reduced of [true, false]) {
  const name = reduced ? "wave-reduced-motion" : "wave-animating";
  const { ctx, page, basemap } = await openPage(WINDS[0], [1440, 900], false, { reducedMotion: reduced });
  await page.goto(`${base}/#z=17.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`, { waitUntil: "networkidle", timeout: 90_000 });
  await waitForArrows(page, 200);
  let a;
  if (reduced) {
    const t0 = Date.now();
    a = await restingFrame(page);
    restMs = Date.now() - t0;
  } else {
    await page.waitForTimeout(restMs + 1000);
    a = await snap(page);
  }
  await page.waitForTimeout(2000);
  const b = await snap(page);
  const moved = !a || !a.equals(b);
  const ok = reduced ? !moved : moved;
  const what = !a ? "never came to rest in 20 s" : moved ? "frames differ" : "frames identical";
  if (!ok) failed = true;
  report.push({ name, ok, wave: what, basemap });
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(28)} ${what} (want ${reduced ? "identical" : "differ"})`);
  await ctx.close();
}

// The onboarding hint, once, on the opening view.
{
  const { ctx, page, basemap } = await openPage(WINDS[0], [1440, 900], false, { onboarded: false });
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 90_000 });
  const p = await waitForArrows(page, 200);
  await page.waitForTimeout(1500);
  await snap(page, join(outDir, "hint-desktop.png"));
  record("hint-desktop", p, basemap, 200, await drawnArrows(page));
  await ctx.close();
}

// The route panel: empty, then a shared route (URL hash) with routes ranked, then the
// bike-type picker open when the build has one. First wind.
{
  const wind = WINDS[0];
  const { ctx, page, basemap } = await openPage(wind, [1440, 900], false);
  await page.goto(`${base}/`, { waitUntil: "networkidle", timeout: 90_000 });
  await waitForArrows(page, 1);
  await page.locator('button:has-text("Plan route")').first().click({ force: true });
  await page.waitForTimeout(800);
  await snap(page, join(outDir, "panel-empty.png"));
  record("panel-empty", await probe(page), basemap, 0);
  await ctx.close();

  const route = `s=${PLACES.start.lat},${PLACES.start.lon}&e=${PLACES.end.lat},${PLACES.end.lon}`;
  const r = await openPage(wind, [1440, 900], false);
  await r.page.goto(`${base}/#${route}`, { waitUntil: "networkidle", timeout: 90_000 });
  const routeBtn = r.page.locator("button").filter({ hasText: /\d+ min/ }).first();
  const routed = await routeBtn.waitFor({ state: "visible", timeout: 60_000 }).then(() => true).catch(() => false);
  await r.page.waitForTimeout(1500);
  await snap(r.page, join(outDir, "panel-routes.png"));
  const nRoutes = await r.page.locator("button").filter({ hasText: /\d+ min/ }).count();
  const canyonEdges = (await probe(r.page))?.canyonEdges ?? null; // step 2b: edges joined to the canyon table
  if (!routed) failed = true;
  report.push({ name: "panel-routes", ok: routed, routes: nRoutes, canyonEdges, basemap: r.basemap });
  console.log(`${routed ? "ok  " : "FAIL"} panel-routes                 routes=${nRoutes}  canyonEdges=${canyonEdges}`);
  const picker = r.page.locator('button[aria-label="Change bike type"]');
  if (await picker.count()) {
    await picker.click();
    await r.page.waitForTimeout(500);
    await snap(r.page, join(outDir, "panel-picker.png"));
    console.log("ok   panel-picker");
  } else {
    console.log("skip panel-picker (no bike-type control in this build)");
  }
  const text = await r.page.locator('button:has-text("Clear all")').locator("xpath=ancestor::div[1]").innerText().catch(() => "");
  await writeFile(join(outDir, "panel-text.txt"), text);
  await r.ctx.close();
}

await browser.close();
server.close();

// report.md — what a reader (or the next agent) needs without opening the PNGs.
const fatal = errors.filter((e) => e.startsWith("pageerror"));
const anyBasemap = report.some((r) => r.basemap && r.basemap.ok > 0);
const lines = [
  `# Renders: ${label}`,
  "",
  `Generated ${new Date().toISOString()} by \`npm run shots -- ${label}\`.`,
  `Basemap: ${anyBasemap ? "loaded from CARTO" : "NOT loaded (no tile responses — offline machine?); pictures show the app's own layers only"}.`,
  `Result: ${failed || fatal.length ? "FAIL" : "PASS"}.`,
  "",
  "`arrows` is the field the CPU built for the view, padding included; `drawn` is how many of them the GPU drew on screen.",
  "",
  "| shot | ok | arrows | drawn | min | zoom | tiles | basemap ok/failed |",
  "|---|---|---|---|---|---|---|---|",
  ...report.map((r) => `| ${r.name} | ${r.ok ? "yes" : "NO"} | ${r.arrows ?? (r.routes !== undefined ? `${r.routes} routes, canyonEdges ${r.canyonEdges}` : r.wave ?? "")} | ${r.drawn ?? ""} | ${r.want ?? ""} | ${r.zoom ?? ""} | ${r.tiles ?? ""} | ${r.basemap ? `${r.basemap.ok}/${r.basemap.failed}` : ""} |`),
  "",
  errors.length ? `## Browser messages\n\n${[...new Set(errors)].map((e) => `- ${e}`).join("\n")}` : "No browser errors.",
  "",
];
await writeFile(join(outDir, "report.md"), lines.join("\n"));

if (errors.length) console.error(`\n${errors.length} browser message(s):\n${[...new Set(errors)].join("\n")}`);
console.log(`\nWrote ${outDir} — ${failed || fatal.length ? "FAIL" : "PASS"}`);
if (failed || fatal.length) process.exit(1);
