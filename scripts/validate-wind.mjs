// scripts/validate-wind.mjs
//
// Validates ambient 10 m wind MODELS against independent live observations,
// sampled at each station's exact coordinates (apples-to-apples: same place,
// same 10 m height, same time). Compares multiple model providers so the data
// decides which is most accurate for Copenhagen — and so collection keeps
// working when any single provider is down.
//
// Models compared:
//   - MET Norway (yr.no) locationforecast — reliable, keyless (primary).
//   - Open-Meteo — what the app currently uses (best-effort; skipped if down).
//
// Ground truth (observations):
//   - METAR EKCH (Copenhagen Airport) — no API key.
//   - DMI metObs stations across greater Copenhagen — open access (no key).
//     If DMI ever re-enables auth, set DMI_API_KEY and it is passed through.
//
// Each run appends every (model, obs) pair to validation-log.ndjson and prints a
// per-model running aggregate so repeated/scheduled runs accumulate a dataset.

import { readFile, appendFile } from "node:fs/promises";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const MET_NO = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const MET_NO_UA = "cph-wind-validation/1.0 (https://github.com/djboy26/cph-wind; sourabhrj26@gmail.com)";
const METAR_URL = "https://aviationweather.gov/api/data/metar?ids=EKCH&format=json";
const DMI_BASE = "https://dmigw.govcloud.dk/v2/metObs/collections/observation/items";
const DMI_KEY = process.env.DMI_API_KEY;
const LOG_PATH = "validation-log.ndjson";

const KT_TO_MS = 0.514444;
// Greater-Copenhagen bbox (lon,lat order, OGC): minLon,minLat,maxLon,maxLat
const CPH_BBOX = [12.40, 55.55, 12.75, 55.80];
const MAX_TIME_SKEW_MIN = 40; // obs/model must be within this to be comparable

// ---- Provisional cyclist wind-speed scale (10 m equivalent, m/s) ----
// Provisional: refined when we build the real route-planning categorization.
const CYCLIST_BINS = [
  { name: "calm", max: 1.5 },
  { name: "light", max: 3.3 },
  { name: "moderate", max: 5.5 },
  { name: "fresh", max: 7.9 },
  { name: "strong", max: 10.7 },
  { name: "severe", max: Infinity },
];
function cyclistCategory(ms) {
  for (const b of CYCLIST_BINS) if (ms < b.max) return b.name;
  return "severe";
}

function angDiff(a, b) {
  if (a == null || b == null) return null;
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Resilient JSON fetch: per-attempt timeout + retry with backoff, surfacing the
// real cause (ECONNRESET / HTTP 429 / non-JSON) instead of opaque "fetch failed".
async function getJson(url, opts = {}, { retries = 4, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.status === 429 ? " (rate limited)" : ""}`);
      try {
        return JSON.parse(body);
      } catch {
        throw new Error(`non-JSON response (${body.slice(0, 40).replace(/\s+/g, " ")}…)`);
      }
    } catch (e) {
      lastErr = e;
      const reason = e.cause?.code || e.message || e.name;
      if (attempt < retries) {
        const rate = /429|rate|non-JSON|502|503/.test(reason);
        const backoff = (rate ? 4000 : 1000) * 2 ** attempt;
        console.warn(`    retry ${attempt + 1}/${retries} (${reason}) in ${backoff}ms…`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${lastErr?.cause?.code || lastErr?.message || "unknown error"} for ${url.split("?")[0]}`);
}

// Open-Meteo returns UTC timestamps WITHOUT a trailing Z; normalize to UTC.
function toUtcMs(s) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
  const withSecs = /T\d{2}:\d{2}$/.test(s) ? s + ":00" : s;
  return new Date(withSecs + "Z").getTime();
}
function minutesBetween(a, b) {
  return Math.abs(toUtcMs(a) - toUtcMs(b)) / 60000;
}

// ---------- Observation sources ----------

async function fetchMetar() {
  try {
    const j = await getJson(METAR_URL, { headers: { "User-Agent": "cph-wind-validation" } });
    const m = j[0];
    if (!m) return [];
    const dir = typeof m.wdir === "number" ? m.wdir : null; // VRB → not a number
    return [{
      source: "METAR", station: m.icaoId || "EKCH", lat: m.lat, lon: m.lon,
      time: m.reportTime || m.obsTime, dirDeg: dir,
      speedMs: m.wspd != null ? m.wspd * KT_TO_MS : null,
      gustMs: m.wgst != null ? m.wgst * KT_TO_MS : null,
    }];
  } catch (e) {
    console.warn("  METAR fetch failed:", e.message);
    return [];
  }
}

function dmiUrl(parameterId, fromISO, toISO) {
  const p = new URLSearchParams({
    parameterId, bbox: CPH_BBOX.join(","), datetime: `${fromISO}/${toISO}`, limit: "1000",
  });
  if (DMI_KEY) p.set("api-key", DMI_KEY);
  return `${DMI_BASE}?${p}`;
}

function latestPerStation(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const id = p.stationId;
    if (!id) continue;
    const prev = out.get(id);
    if (!prev || p.observed > prev.observed) {
      out.set(id, { observed: p.observed, value: p.value, coords: f.geometry?.coordinates });
    }
  }
  return out;
}

async function fetchDmi() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 60 * 1000);
  const fromISO = from.toISOString().replace(/\.\d+Z$/, "Z");
  const toISO = to.toISOString().replace(/\.\d+Z$/, "Z");
  try {
    const [spd, dir] = await Promise.all([
      getJson(dmiUrl("wind_speed", fromISO, toISO)),
      getJson(dmiUrl("wind_dir", fromISO, toISO)),
    ]);
    const speeds = latestPerStation(spd.features || []);
    const dirs = latestPerStation(dir.features || []);
    const rows = [];
    for (const [id, s] of speeds) {
      const d = dirs.get(id);
      const coords = s.coords || d?.coords;
      if (!coords) continue;
      rows.push({
        source: "DMI", station: id, lat: coords[1], lon: coords[0],
        time: s.observed, speedMs: s.value, dirDeg: d ? d.value : null, gustMs: null,
      });
    }
    return rows;
  } catch (e) {
    console.warn("  DMI fetch failed:", e.message);
    return [];
  }
}

// ---------- Model providers ----------
// Each returns an array aligned to `points`, with null where that point failed.

async function metNorwayAll(points, retries) {
  const now = Date.now();
  const results = await Promise.allSettled(points.map(async (q) => {
    const url = `${MET_NO}?lat=${q.lat.toFixed(4)}&lon=${q.lon.toFixed(4)}`;
    const j = await getJson(url, { headers: { "User-Agent": MET_NO_UA } }, { retries });
    const ts = j.properties.timeseries;
    let best = ts[0], bestDiff = Infinity;
    for (const t of ts) {
      const diff = Math.abs(new Date(t.time).getTime() - now);
      if (diff < bestDiff) { bestDiff = diff; best = t; }
    }
    const d = best.data.instant.details;
    return { time: best.time, dirDeg: d.wind_from_direction, speedMs: d.wind_speed, gustMs: d.wind_speed_of_gust ?? null };
  }));
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}

async function openMeteoAll(points, retries) {
  try {
    const p = new URLSearchParams({
      latitude: points.map((q) => q.lat.toFixed(4)).join(","),
      longitude: points.map((q) => q.lon.toFixed(4)).join(","),
      current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      wind_speed_unit: "ms",
    });
    const j = await getJson(`${OPEN_METEO}?${p}`, {}, { retries });
    const arr = Array.isArray(j) ? j : [j];
    if (arr.length !== points.length) throw new Error(`returned ${arr.length} for ${points.length} points`);
    return arr.map((x) => ({
      time: x.current.time, dirDeg: x.current.wind_direction_10m,
      speedMs: x.current.wind_speed_10m, gustMs: x.current.wind_gusts_10m,
    }));
  } catch (e) {
    console.warn(`  open_meteo: ${e.message} — skipping this model this run`);
    return points.map(() => null);
  }
}

const MODELS = [
  { name: "met_norway", fetch: metNorwayAll, retries: 3 },
  { name: "open_meteo", fetch: openMeteoAll, retries: 2 },
];

// ---------- Main ----------

async function main() {
  // Read-only verdict from accumulated data — no network, no log changes.
  // Safe to run locally anytime (`node scripts/validate-wind.mjs --report`),
  // unlike a normal run which the cloud owns.
  if (process.argv.includes("--report")) {
    await printAggregate();
    return;
  }

  console.log("Fetching live observations…");
  const obs = [...(await fetchMetar()), ...(await fetchDmi())];
  if (obs.length === 0) {
    console.error("No observations available — aborting.");
    process.exit(1);
  }
  const validObs = obs.filter((o) => o.speedMs != null && o.lat != null && o.lon != null);
  console.log(`Got ${validObs.length} station observation(s). Querying ${MODELS.length} model(s)…\n`);

  const pairs = [];
  for (const model of MODELS) {
    const results = await model.fetch(validObs, model.retries);
    for (let i = 0; i < validObs.length; i++) {
      const m = results[i];
      if (!m || m.speedMs == null) continue;
      const o = validObs[i];
      const skew = minutesBetween(o.time, m.time);
      pairs.push({
        ts: new Date().toISOString(), model: model.name,
        source: o.source, station: o.station, lat: o.lat, lon: o.lon,
        obsTime: o.time, modelTime: m.time, skewMin: Math.round(skew),
        obsSpeed: o.speedMs, modSpeed: m.speedMs, obsDir: o.dirDeg, modDir: m.dirDeg,
        speedErr: m.speedMs - o.speedMs, dirErr: angDiff(m.dirDeg, o.dirDeg),
        obsCat: cyclistCategory(o.speedMs), modCat: cyclistCategory(m.speedMs),
        comparable: skew <= MAX_TIME_SKEW_MIN,
      });
    }
  }

  if (pairs.length === 0) {
    console.warn("⚠ No model produced a comparison this run (all model endpoints down). Will retry next run.");
    await printAggregate();
    return;
  }

  // ---- Per-pair table for this run ----
  console.log("Model       Source  Station    skew  obs→model (m/s)   dir err   cat");
  console.log("----------  ------  ---------  ----  ----------------  -------  -----");
  for (const p of pairs) {
    const dirErr = p.dirErr == null ? "  n/a" : `${p.dirErr.toFixed(0).padStart(4)}°`;
    const flag = p.comparable ? " " : "*";
    const catFlag = p.obsCat === p.modCat ? "✓" : "✗";
    console.log(
      `${p.model.padEnd(10)}  ${p.source.padEnd(6)}  ${String(p.station).padEnd(9)}  ${String(p.skewMin).padStart(3)}m${flag}  ` +
      `${p.obsSpeed.toFixed(1).padStart(5)} →${p.modSpeed.toFixed(1).padStart(5)} (${(p.speedErr >= 0 ? "+" : "") + p.speedErr.toFixed(1)})`.padEnd(16) +
      `  ${dirErr}    ${catFlag}`,
    );
  }
  console.log("  (* = obs/model >40 min apart)\n");

  // ---- Append, skipping pairs already recorded (model+station+obs-time) ----
  const existing = await readLog();
  const key = (p) => `${p.model || "open_meteo"}|${p.source}|${p.station}|${p.obsTime}`;
  const seen = new Set(existing.map(key));
  const fresh = pairs.filter((p) => !seen.has(key(p)));
  if (fresh.length > 0) {
    await appendFile(LOG_PATH, fresh.map((p) => JSON.stringify(p)).join("\n") + "\n", "utf-8");
  }
  console.log(`Logged ${fresh.length} new pair(s) (${pairs.length - fresh.length} already in log) → ${LOG_PATH}`);

  await printAggregate();
}

async function readLog() {
  try {
    const txt = await readFile(LOG_PATH, "utf-8");
    return txt.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

const OCTANTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function octant(deg) {
  if (deg == null) return "?";
  return OCTANTS[Math.round(deg / 45) % 8];
}

function statsFor(rows) {
  const n = rows.length;
  const se = rows.map((p) => p.speedErr);
  const bias = se.reduce((a, b) => a + b, 0) / n;
  const mae = se.reduce((a, b) => a + Math.abs(b), 0) / n;
  const rmse = Math.sqrt(se.reduce((a, b) => a + b * b, 0) / n);
  const de = rows.map((p) => p.dirErr).filter((d) => d != null);
  const dirMae = de.length ? de.reduce((a, b) => a + b, 0) / de.length : null;
  const catAgree = rows.filter((p) => p.obsCat === p.modCat).length / n;
  return { n, bias, mae, rmse, dirMae, catAgree };
}

async function printAggregate() {
  const all = await readLog();
  if (all.length === 0) return;
  const usable = all.filter((p) => p.comparable && p.obsSpeed != null && p.modSpeed != null);
  if (usable.length === 0) return;

  // Group by model (older rows without a model field were Open-Meteo).
  const byModel = new Map();
  for (const p of usable) {
    const m = p.model || "open_meteo";
    if (!byModel.has(m)) byModel.set(m, []);
    byModel.get(m).push(p);
  }

  const span = `${all[0].ts.slice(0, 16)} … ${all[all.length - 1].ts.slice(0, 16)}`;
  console.log(`\n=== Running aggregate per model (over ${span}) ===`);
  console.log("model        n   speed bias   MAE / RMSE     dir MAE   cat agree");
  console.log("----------  ---  ----------   -----------    -------   ---------");
  for (const [m, rows] of [...byModel].sort()) {
    const s = statsFor(rows);
    console.log(
      `${m.padEnd(10)}  ${String(s.n).padStart(3)}  ` +
      `${(s.bias >= 0 ? "+" : "") + s.bias.toFixed(2)} m/s`.padStart(10) + "   " +
      `${s.mae.toFixed(2)} / ${s.rmse.toFixed(2)}`.padEnd(11) + "    " +
      `${s.dirMae == null ? "n/a" : s.dirMae.toFixed(1) + "°"}`.padStart(6) + "    " +
      `${(s.catAgree * 100).toFixed(0)}%`,
    );
  }
  console.log("(bias: + = model too windy vs obs)");

  // ---- Plain-English verdict for the model with the most samples ----
  const primary = [...byModel.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (primary) {
    const [name, rows] = primary;
    const s = statsFor(rows);
    const verdict = s.n < 30 ? "TOO FEW SAMPLES to trust yet" :
      s.mae < 1.2 && (s.dirMae ?? 99) < 25 ? "GOOD agreement with real observations" :
      s.mae < 2 && (s.dirMae ?? 99) < 45 ? "FAIR agreement" : "POOR agreement — investigate";
    console.log(`\nPlain reading — ${name} (${s.n} samples): ${verdict}.`);
    console.log(`  The base wind was on average within ${s.mae.toFixed(1)} m/s and ` +
      `${s.dirMae == null ? "?" : s.dirMae.toFixed(0) + "°"} of real observations,`);
    console.log(`  and matched the cyclist wind category ${(s.catAgree * 100).toFixed(0)}% of the time.`);
  }

  // ---- Regime coverage over distinct observations (model-independent) ----
  const seenObs = new Set();
  const distinct = usable.filter((p) => {
    const k = `${p.source}|${p.station}|${p.obsTime}`;
    if (seenObs.has(k)) return false;
    seenObs.add(k);
    return true;
  });
  const byCat = new Map(CYCLIST_BINS.map((b) => [b.name, 0]));
  const byOct = new Map(OCTANTS.map((o) => [o, 0]));
  for (const p of distinct) {
    byCat.set(p.obsCat, (byCat.get(p.obsCat) || 0) + 1);
    byOct.set(octant(p.obsDir), (byOct.get(octant(p.obsDir)) || 0) + 1);
  }
  console.log(`\nregime coverage (${distinct.length} distinct observations):`);
  console.log("  by speed : " + [...byCat].map(([k, v]) => `${k} ${v}`).join("  "));
  console.log("  by dir   : " + [...byOct].map(([k, v]) => `${k} ${v}`).join("  "));

  if (distinct.length < 30) {
    console.log(`\nNOTE: only ${distinct.length} distinct obs — not yet statistically meaningful.`);
    console.log("Keep collecting until coverage spans calm→strong and several directions.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
