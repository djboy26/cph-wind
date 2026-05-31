// scripts/compute-canyons.mjs
import { readFile, writeFile } from "node:fs/promises";
import Flatbush from "flatbush";

const BUILDINGS_PATH = "public/data/cph-buildings.json";
const ROADS_PATH = "public/data/cph-roads.json";
const OUTPUT_PATH = "public/data/cph-segments.json";

const SEARCH_RADIUS_M = 25;
const MIN_SEGMENT_M = 20;

const WIDTHS = {
  primary: 18,
  secondary: 14,
  tertiary: 11,
  unclassified: 9,
  residential: 9,
  living_street: 7,
  cycleway: 4,
  path: 3,
  pedestrian: 6,
  footway: 3,
  service: 6,
};
const DEFAULT_WIDTH = 9;

const CPH_LAT = 55.6761;
const CPH_LON = 12.5683;
const MPER_DEG_LAT = 111000;
const MPER_DEG_LON = 111000 * Math.cos((CPH_LAT * Math.PI) / 180);

function toLocal(lon, lat) {
  return {
    x: (lon - CPH_LON) * MPER_DEG_LON,
    y: (lat - CPH_LAT) * MPER_DEG_LAT,
  };
}
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
function bearingDeg(lon1, lat1, lon2, lat2) {
  const meanLat = ((lat1 + lat2) / 2) * (Math.PI / 180);
  const dx = (lon2 - lon1) * Math.cos(meanLat);
  const dy = lat2 - lat1;
  let theta = (Math.atan2(dx, dy) * 180) / Math.PI;
  if (theta < 0) theta += 360;
  return theta;
}

async function main() {
  console.log("Loading data...");
  const t0 = Date.now();
  const buildings = JSON.parse(await readFile(BUILDINGS_PATH, "utf-8"));
  const roads = JSON.parse(await readFile(ROADS_PATH, "utf-8"));
  console.log(`Loaded ${buildings.features.length} buildings, ${roads.features.length} roads in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("Computing building centroids...");
  const bX = [], bY = [], bH = [];
  for (const f of buildings.features) {
    let coords;
    if (f.geometry.type === "Polygon") coords = f.geometry.coordinates[0];
    else if (f.geometry.type === "MultiPolygon") coords = f.geometry.coordinates[0][0];
    else continue;
    let sumX = 0, sumY = 0;
    for (const c of coords) {
      const p = toLocal(c[0], c[1]);
      sumX += p.x; sumY += p.y;
    }
    bX.push(sumX / coords.length);
    bY.push(sumY / coords.length);
    bH.push(f.properties.heightM);
  }

  console.log("Building spatial index...");
  const index = new Flatbush(bX.length);
  for (let i = 0; i < bX.length; i++) {
    index.add(bX[i], bY[i], bX[i], bY[i]);
  }
  index.finish();

  console.log("Computing per-segment canyons...");
  const segments = [];
  let n = 0;
  for (const feature of roads.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    const highway = feature.properties.highway || "default";
    const widthM = WIDTHS[highway] ?? DEFAULT_WIDTH;

    for (let i = 0; i < coords.length - 1; i++) {
      const [lonA, latA] = coords[i];
      const [lonB, latB] = coords[i + 1];
      const a = toLocal(lonA, latA);
      const b = toLocal(lonB, latB);
      if (dist(a.x, a.y, b.x, b.y) < MIN_SEGMENT_M) continue;

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;

      const candidates = index.search(
        midX - SEARCH_RADIUS_M, midY - SEARCH_RADIUS_M,
        midX + SEARCH_RADIUS_M, midY + SEARCH_RADIUS_M,
      );

      let totalH = 0, count = 0;
      for (const idx of candidates) {
        if (dist(bX[idx], bY[idx], midX, midY) <= SEARCH_RADIUS_M) {
          totalH += bH[idx];
          count++;
        }
      }

      segments.push({
        wayId: feature.properties.id,
        lon: (lonA + lonB) / 2,
        lat: (latA + latB) / 2,
        bearingDeg: bearingDeg(lonA, latA, lonB, latB),
        canyonH: count > 0 ? totalH / count : 0,
        canyonW: widthM,
      });
      n++;
      if (n % 20000 === 0) console.log(`  ${n} segments...`);
    }
  }

  console.log(`Total segments: ${segments.length}`);
  const lambdas = segments.map((s) => s.canyonH / s.canyonW);
  const b = { none: 0, shallow: 0, moderate: 0, deep: 0 };
  for (const l of lambdas) {
    if (l < 0.1) b.none++;
    else if (l < 0.3) b.shallow++;
    else if (l < 0.7) b.moderate++;
    else b.deep++;
  }
  console.log("Canyon distribution:");
  console.log(`  None (lambda<0.1):     ${b.none}`);
  console.log(`  Shallow (0.1-0.3): ${b.shallow}`);
  console.log(`  Moderate (0.3-0.7): ${b.moderate}`);
  console.log(`  Deep (lambda>0.7):     ${b.deep}`);

  await writeFile(OUTPUT_PATH, JSON.stringify(segments));
  const sizeMB = (JSON.stringify(segments).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
