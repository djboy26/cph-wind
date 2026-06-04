// scripts/validate-wind.mjs
//
// Validates the AMBIENT wind input (raw Open-Meteo 10 m wind, before the app's
// ×0.6 boundary-layer factor and canyon channeling) against independent live
// observations, sampled at each station's exact coordinates (apples-to-apples:
// same place, same 10 m height, same time).
//
// Ground truth:
//   - METAR EKCH (Copenhagen Airport) — no API key.
//   - DMI metObs stations across greater Copenhagen — currently open access
//     (no key needed). If DMI ever re-enables auth, set DMI_API_KEY and it is
//     passed through automatically.
//
// Each run prints per-station errors + a cyclist-category confusion check, and
// appends every (obs, model) pair to validation-log.ndjson so repeated/scheduled
// runs accumulate a multi-regime dataset. It then prints running aggregate stats.

import { readFile, appendFile } from "node:fs/promises";

const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";
const METAR_URL = "https://aviationweather.gov/api/data/metar?ids=EKCH&format=json";
const DMI_BASE = "https://dmigw.govcloud.dk/v2/metObs/collections/observation/items";
const DMI_KEY = process.env.DMI_API_KEY;
const LOG_PATH = "validation-log.ndjson";

const KT_TO_MS = 0.514444;
// Greater-Copenhagen bbox (lon,lat order, OGC): minLon,minLat,maxLon,maxLat
const CPH_BBOX = [12.40, 55.55, 12.75, 55.80];
const MAX_TIME_SKEW_MIN = 20; // obs/model must be within this to be comparable

// ---- Provisional cyclist wind-speed scale (10 m equivalent, m/s) ----
// Marked provisional: we refine these thresholds when we build the real
// route-planning categorization. Used here only for the agreement check.
const CYCLIST_BINS = [
  { name: "calm", max: 1.5 },     // unnoticeable
  { name: "light", max: 3.3 },    // barely felt
  { name: "moderate", max: 5.5 }, // noticeable effort into a headwind
  { name: "fresh", max: 7.9 },    // hard work into a headwind
  { name: "strong", max: 10.7 },  // tough, affects balance
  { name: "severe", max: Infinity }, // avoid / hazardous
];
function cyclistCategory(ms) {
  for (const b of CYCLIST_BINS) if (ms < b.max) return b.name;
  return "severe";
}

function angDiff(a, b) {
  if (a == null || b == null) return null;
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.split("?")[0]}`);
  return res.json();
}

// ---------- Observation sources ----------

async function fetchMetar() {
  try {
    const j = await getJson(METAR_URL, { headers: { "User-Agent": "cph-wind-validation" } });
    const m = j[0];
    if (!m) return [];
    const dir = typeof m.wdir === "number" ? m.wdir : null; // VRB → not a number
    return [{
      source: "METAR",
      station: m.icaoId || "EKCH",
      lat: m.lat,
      lon: m.lon,
      time: m.reportTime || m.obsTime,
      dirDeg: dir,
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
    parameterId,
    bbox: CPH_BBOX.join(","),
    datetime: `${fromISO}/${toISO}`,
    limit: "1000",
  });
  if (DMI_KEY) p.set("api-key", DMI_KEY); // only if DMI re-enables auth
  return `${DMI_BASE}?${p}`;
}

// Latest value per station for a given parameter.
function latestPerStation(features) {
  const out = new Map();
  for (const f of features) {
    const p = f.properties || {};
    const id = p.stationId;
    if (!id) continue;
    const prev = out.get(id);
    if (!prev || p.observed > prev.observed) {
      out.set(id, {
        observed: p.observed,
        value: p.value,
        coords: f.geometry?.coordinates, // [lon, lat]
      });
    }
  }
  return out;
}

async function fetchDmi() {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 60 * 1000); // last 90 min
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
        source: "DMI",
        station: id,
        lat: coords[1],
        lon: coords[0],
        time: s.observed,
        speedMs: s.value,
        dirDeg: d ? d.value : null,
        gustMs: null,
      });
    }
    return rows;
  } catch (e) {
    console.warn("  DMI fetch failed:", e.message);
    return [];
  }
}

// ---------- Model ----------

async function fetchOpenMeteo(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "ms",
  });
  const j = await getJson(`${OPEN_METEO}?${p}`);
  const c = j.current;
  return { time: c.time, dirDeg: c.wind_direction_10m, speedMs: c.wind_speed_10m, gustMs: c.wind_gusts_10m };
}

// ---------- Main ----------

// Open-Meteo returns UTC timestamps WITHOUT a trailing Z (e.g. "2026-06-04T07:45"),
// which Date() would misread as local time. Normalize anything lacking a timezone
// designator to UTC before comparing.
function toUtcMs(s) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
  const withSecs = /T\d{2}:\d{2}$/.test(s) ? s + ":00" : s;
  return new Date(withSecs + "Z").getTime();
}
function minutesBetween(a, b) {
  return Math.abs(toUtcMs(a) - toUtcMs(b)) / 60000;
}

async function main() {
  console.log("Fetching live observations…");
  const obs = [...(await fetchMetar()), ...(await fetchDmi())];
  if (obs.length === 0) {
    console.error("No observations available — aborting.");
    process.exit(1);
  }
  console.log(`Got ${obs.length} station observation(s). Sampling Open-Meteo at each…\n`);

  const pairs = [];
  for (const o of obs) {
    if (o.speedMs == null) continue;
    let model;
    try {
      model = await fetchOpenMeteo(o.lat, o.lon);
    } catch (e) {
      console.warn(`  Open-Meteo failed for ${o.station}: ${e.message}`);
      continue;
    }
    const skew = minutesBetween(o.time, model.time);
    pairs.push({
      ts: new Date().toISOString(),
      source: o.source,
      station: o.station,
      lat: o.lat, lon: o.lon,
      obsTime: o.time, modelTime: model.time, skewMin: Math.round(skew),
      obsSpeed: o.speedMs, modSpeed: model.speedMs,
      obsDir: o.dirDeg, modDir: model.dirDeg,
      speedErr: model.speedMs - o.speedMs,
      dirErr: angDiff(model.dirDeg, o.dirDeg),
      obsCat: cyclistCategory(o.speedMs),
      modCat: cyclistCategory(model.speedMs),
      comparable: skew <= MAX_TIME_SKEW_MIN,
    });
  }

  // ---- Per-station table for this run ----
  console.log("Source  Station        skew  obs→model speed (m/s)   dir err   obs cat → model cat");
  console.log("------  -------------  -----  -------------------------  -------  --------------------");
  for (const p of pairs) {
    const dirErr = p.dirErr == null ? "  n/a" : `${p.dirErr.toFixed(0).padStart(4)}°`;
    const flag = p.comparable ? " " : "*";
    const catFlag = p.obsCat === p.modCat ? "✓" : "✗";
    console.log(
      `${p.source.padEnd(6)}  ${String(p.station).padEnd(13)}  ${String(p.skewMin).padStart(3)}m${flag}  ` +
      `${p.obsSpeed.toFixed(1).padStart(5)} → ${p.modSpeed.toFixed(1).padStart(5)}  (${(p.speedErr >= 0 ? "+" : "") + p.speedErr.toFixed(1)})`.padEnd(25) +
      `  ${dirErr}    ${p.obsCat} → ${p.modCat} ${catFlag}`,
    );
  }
  console.log("  (* = obs/model >20 min apart, treat with caution)\n");

  // ---- Append to log, skipping observations already recorded ----
  // Dedup key = source+station+observation-time, so re-running before a new
  // obs arrives (METAR ~hourly) does not count the same reading twice.
  const existing = await readLog();
  const seen = new Set(existing.map((p) => `${p.source}|${p.station}|${p.obsTime}`));
  const fresh = pairs.filter((p) => !seen.has(`${p.source}|${p.station}|${p.obsTime}`));
  if (fresh.length > 0) {
    await appendFile(LOG_PATH, fresh.map((p) => JSON.stringify(p)).join("\n") + "\n", "utf-8");
  }
  console.log(`Logged ${fresh.length} new pair(s) (${pairs.length - fresh.length} already in log) → ${LOG_PATH}`);

  // ---- Running aggregate over the whole log ----
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

async function printAggregate() {
  const all = await readLog();
  if (all.length === 0) return;
  const usable = all.filter((p) => p.comparable && p.obsSpeed != null && p.modSpeed != null);
  if (usable.length === 0) return;

  const n = usable.length;
  const speedErrs = usable.map((p) => p.speedErr);
  const bias = speedErrs.reduce((a, b) => a + b, 0) / n;
  const mae = speedErrs.reduce((a, b) => a + Math.abs(b), 0) / n;
  const rmse = Math.sqrt(speedErrs.reduce((a, b) => a + b * b, 0) / n);

  const dirErrs = usable.map((p) => p.dirErr).filter((d) => d != null);
  const dirMae = dirErrs.length ? dirErrs.reduce((a, b) => a + b, 0) / dirErrs.length : null;

  const catAgree = usable.filter((p) => p.obsCat === p.modCat).length / n;

  const span = `${all[0].ts.slice(0, 16)} … ${all[all.length - 1].ts.slice(0, 16)}`;
  console.log("\n=== Running aggregate (whole log) ===");
  console.log(`samples           : ${n}   (over ${span})`);
  console.log(`speed bias        : ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} m/s  (model − obs; + = model too windy)`);
  console.log(`speed MAE / RMSE  : ${mae.toFixed(2)} / ${rmse.toFixed(2)} m/s`);
  console.log(`direction MAE     : ${dirMae == null ? "n/a" : dirMae.toFixed(1) + "°"}`);
  console.log(`cyclist-cat agree : ${(catAgree * 100).toFixed(0)}%  (model & obs land in same wind category)`);

  // ---- Regime coverage: shows which conditions still need samples ----
  const byCat = new Map();
  for (const b of CYCLIST_BINS) byCat.set(b.name, 0);
  const byOct = new Map(OCTANTS.map((o) => [o, 0]));
  for (const p of usable) {
    byCat.set(p.obsCat, (byCat.get(p.obsCat) || 0) + 1);
    byOct.set(octant(p.obsDir), (byOct.get(octant(p.obsDir)) || 0) + 1);
  }
  console.log("\nregime coverage (observed):");
  console.log("  by speed : " + [...byCat].map(([k, v]) => `${k} ${v}`).join("  "));
  console.log("  by dir   : " + [...byOct].map(([k, v]) => `${k} ${v}`).join("  "));

  if (n < 30) {
    console.log(`\nNOTE: only ${n} samples — not yet statistically meaningful. Keep running hourly`);
    console.log("until the coverage above spans calm→strong and several directions (~1–2 weeks).");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
