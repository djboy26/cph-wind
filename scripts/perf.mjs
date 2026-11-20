// scripts/perf.mjs — what the gestures that matter cost, measured in a real browser.
//
//   npm run build && npm run perf                      # measures dist/
//   npm run perf -- <build dir> [label]                # any other build, e.g. a baseline
//
// Serves a build the way the screenshot harness does (wind mocked, no dev server) and
// drives five gestures with input events 60 times a second:
//
//   pan-city      three 600 px drags at the desktop opening view (zoom 13.5)
//   zoom-in       wheel from the opening view to street zoom, then 3 s at rest; the first
//                 zoom past 14 loads the 42 MB 3D-buildings file
//   pan-street    three drags at zoom 16.5 with the buildings up
//   scrub         twelve steps along the forecast slider at the opening view
//   pan-phone     three drags on a phone viewport, CPU slowed 4× (a mid-range phone)
//
// For each it reports the main thread's script and task time (Chrome's own counters:
// the work this app controls), its long tasks (> 50 ms, when the page cannot answer),
// and the intervals between the frames the page saw. It prints the WebGL renderer first:
// on SwiftShader (no GPU) every frame is software-rendered and only the script time
// compares two builds fairly. PERF_GPU=1 asks for the machine's GPU (new headless mode).
// PERF_ONLY=zoom-in,scrub runs a subset. Writes reports/perf-<label>.json (not committed).
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { serveDist } from "./shots/serve.mjs";
import { metFixture } from "./shots/fixture.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(process.argv[2] ?? join(root, "dist"));
const label = process.argv[3] ?? basename(distDir);
const ONBOARDED_KEY = "cphwind.onboarded.v1"; // OnboardingHint.tsx
const HCA = { lat: 55.6754, lon: 12.5687 }; // as in shots.mjs
const WIND = { speed: 4.4, dir: 240, gust: 7 };
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const server = await serveDist(distDir);
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({
  ...(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {}),
  ...(process.env.PERF_GPU ? { channel: "chromium", args: ["--enable-gpu", "--ignore-gpu-blocklist"] } : {}),
});
const errors = [];
let renderer = null;

async function open(hash, { phone = false } = {}) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    isMobile: phone, hasTouch: phone,
    userAgent: phone ? PHONE_UA : undefined,
  });
  await ctx.addInitScript((k) => { try { localStorage.setItem(k, "1"); } catch { /* ignore */ } }, ONBOARDED_KEY);
  await ctx.route("**/api/wind**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(metFixture(WIND)) }));
  await ctx.route(/photon\.komoot\.io|sentry|vercel-insights|vercel-analytics/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${base}/#${hash}`, { waitUntil: "networkidle", timeout: 90_000 });
  for (let t = 0; t < 60; t++) { // the field is up when the probe counts arrows
    if (((await page.evaluate(() => window.__cphwind?.arrows ?? 0)) > 0)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(2000);
  renderer ??= await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "no WebGL2";
  });
  return { ctx, page };
}

const q = (xs, f) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(f * xs.length))] : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

async function measure(page, gesture, { settleMs = 300, cpuRate = 1 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  if (cpuRate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
  await page.evaluate(() => {
    const w = window;
    w.__perf = { frames: [], long: [], on: true };
    const tick = (t) => { w.__perf.frames.push(t); if (w.__perf.on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    try {
      w.__perf.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__perf.long.push(e.duration); });
      w.__perf.po.observe({ type: "longtask" });
    } catch { /* no long-task timing in this browser */ }
  });
  const read = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const m0 = await read();
  const t0 = Date.now();
  await gesture(page);
  await page.waitForTimeout(settleMs);
  const wallMs = Date.now() - t0;
  const m1 = await read();
  const r = await page.evaluate(() => { const p = window.__perf; p.on = false; p.po?.disconnect(); return { frames: p.frames, long: p.long }; });
  if (cpuRate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await cdp.detach();
  const iv = r.frames.slice(1).map((t, i) => t - r.frames[i]).sort((a, b) => a - b);
  return {
    wallMs,
    scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000),
    taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000),
    longTasks: r.long.length,
    longMs: Math.round(r.long.reduce((a, b) => a + b, 0)),
    worstTaskMs: r.long.length ? Math.round(Math.max(...r.long)) : 0,
    frames: iv.length,
    frameP50: r1(q(iv, 0.5)), frameP95: r1(q(iv, 0.95)), frameMax: r1(iv.at(-1)),
  };
}

async function drag(page, x0, y0, { reps = 3, px = 600 } = {}) {
  for (let rep = 0; rep < reps; rep++) {
    const dir = rep % 2 ? -1 : 1;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) {
      await page.mouse.move(x0 + dir * (i * px) / 60, y0 + (i * 2 * dir));
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
}

const results = [];
const only = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(",")) : null;
async function scenario(name, hash, gesture, opts = {}) {
  if (only && !only.has(name)) return;
  const { ctx, page } = await open(hash, { phone: !!opts.phone });
  if (opts.preWaitMs) await page.waitForTimeout(opts.preWaitMs);
  const m = await measure(page, gesture, opts);
  const zoom = await page.evaluate(() => window.__cphwind?.zoom ?? null);
  if (results.length === 0) console.log(`renderer: ${renderer}`);
  results.push({ name, zoom, ...m });
  console.log(`${name.padEnd(11)} script ${String(m.scriptMs).padStart(5)} ms  tasks ${String(m.taskMs).padStart(5)} ms  long tasks ${m.longTasks} (${m.longMs} ms, worst ${m.worstTaskMs})  frames ${m.frames}: p50 ${m.frameP50} p95 ${m.frameP95} max ${m.frameMax} ms  [${m.wallMs} ms, ends at zoom ${zoom}]`);
  await ctx.close();
}

const street = `z=16.5&lat=${HCA.lat}&lon=${HCA.lon}&pitch=0`;
await scenario("pan-city", "", (p) => drag(p, 420, 450));
await scenario("zoom-in", "", async (p) => {
  await p.mouse.move(720, 450);
  // deck.gl zooms by log2(2 / (1 + e^-|0.01 * delta|)) per wheel event: 0.137 at 20 px.
  for (let i = 0; i < 30; i++) { await p.mouse.wheel(0, -20); await p.waitForTimeout(16); }
}, { settleMs: 3000 });
await scenario("pan-street", street, (p) => drag(p, 420, 450), { preWaitMs: 4000 }); // buildings up first
await scenario("scrub", "", async (p) => {
  await p.focus('input[type="range"]');
  for (let i = 0; i < 12; i++) { await p.keyboard.press("ArrowRight"); await p.waitForTimeout(80); }
});
await scenario("pan-phone", "", (p) => drag(p, 80, 420, { px: 230 }), { phone: true, cpuRate: 4 });

await mkdir(join(root, "reports"), { recursive: true });
await writeFile(join(root, "reports", `perf-${label}.json`), JSON.stringify({ label, dist: distDir, renderer, at: new Date().toISOString(), results, errors }, null, 2));
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 5).join("\n  ")}`);
await browser.close();
server.close();
if (errors.length) process.exitCode = 1;
