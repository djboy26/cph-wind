// scripts/looks-shots.mjs — the same views in every look, for choosing between them.
//
//   npm run build && node scripts/looks-shots.mjs [look,look,...]
//
// Serves dist/ like the screenshot harness (wind mocked), opens three views per look
// (desktop city, desktop street with 3D buildings, phone street) and two bare-map views
// (`hud=0`, the backgrounds for layout sketches), and writes reports/looks/<look>-<view>.png
// at 2x. Not a test: it fails only when a view draws no arrows.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { serveDist } from "./shots/serve.mjs";
import { metFixture } from "./shots/fixture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "reports", "looks");
const LOOKS = (process.argv[2] ?? "morning,night,ink,harbour").split(",");
const BASEMAP_HOST = /tiles\.openfreemap\.org/;
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const STREET = "z=16.5&lat=55.6768&lon=12.5702&pitch=45";
const VIEWS = [
  { name: "city", hash: "", phone: false },
  { name: "street", hash: STREET, phone: false },
  { name: "phone", hash: "z=17&lat=55.6754&lon=12.5687&pitch=0", phone: true },
];
const BARE = [
  { name: "bare-street", hash: `${STREET}&hud=0`, phone: false },
  { name: "bare-phone", hash: "z=17&lat=55.6754&lon=12.5687&pitch=0&hud=0", phone: true },
];

const server = await serveDist(join(root, "dist"));
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {});
await mkdir(out, { recursive: true });
let failed = 0;

async function shoot(look, v) {
  const ctx = await browser.newContext({
    viewport: v.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 2, isMobile: v.phone, hasTouch: v.phone,
    userAgent: v.phone ? PHONE_UA : undefined,
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("cphwind.onboarded.v1", "1"); } catch { /* ignore */ } });
  await ctx.route("**/api/wind**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metFixture({ speed: 4.4, dir: 240, gust: 7 })) }));
  await ctx.route(/photon\.komoot\.io|sentry|vercel-insights|vercel-analytics/, (r) => r.abort());
  const page = await ctx.newPage();
  const bm = { inflight: 0, last: Date.now() };
  page.on("request", (r) => { if (BASEMAP_HOST.test(r.url())) { bm.inflight++; bm.last = Date.now(); } });
  page.on("requestfinished", (r) => { if (BASEMAP_HOST.test(r.url())) { bm.inflight--; bm.last = Date.now(); } });
  page.on("requestfailed", (r) => { if (BASEMAP_HOST.test(r.url())) { bm.inflight--; bm.last = Date.now(); } });
  const hash = [v.hash, `look=${look}`].filter(Boolean).join("&");
  await page.goto(`${base}/#${hash}`, { waitUntil: "networkidle", timeout: 90_000 });
  let arrows = 0;
  for (let t = 0; t < 120; t++) {
    const p = await page.evaluate(() => window.__cphwind ?? null);
    arrows = p?.arrows ?? 0;
    if (arrows > 0 && (p?.buildingsPending ?? 0) === 0) break;
    await page.waitForTimeout(250);
  }
  for (let t0 = Date.now(); Date.now() - t0 < 20_000;) {
    if (bm.inflight <= 0 && Date.now() - bm.last >= 1500) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1500);
  const file = join(out, `${look}-${v.name}.png`);
  await page.screenshot({ path: file });
  console.log(`${arrows > 0 ? "ok  " : "FAIL"} ${look.padEnd(8)} ${v.name.padEnd(12)} arrows=${arrows}`);
  if (!arrows) failed++;
  await ctx.close();
}

for (const look of LOOKS) for (const v of VIEWS) await shoot(look, v);
for (const v of BARE) await shoot("morning", v);
await browser.close();
server.close();
process.exitCode = failed ? 1 : 0;
