// scripts/slim-buildings.mjs
// Derives a compact, browser-loadable 3D-buildings file from the full OSM
// building footprints. Output is a flat array [[heightM, [[lon,lat],…]], …] —
// far smaller than GeoJSON (no per-feature key overhead), gzips to ~10 MB.

import { readFile, writeFile } from "node:fs/promises";

const SRC = "public/data/cph-buildings.json";
const OUT = "public/data/cph-buildings-slim.json";
const DEFAULT_HEIGHT_M = 9;

const r6 = (n) => Math.round(n * 1e6) / 1e6;

function rings(feature) {
  const g = feature.geometry;
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates[0]];
  if (g.type === "MultiPolygon") return g.coordinates.map((p) => p[0]);
  return [];
}

async function main() {
  console.log("Reading buildings…");
  const geo = JSON.parse(await readFile(SRC, "utf-8"));
  const out = [];
  for (const f of geo.features) {
    const h = f.properties?.heightM ?? DEFAULT_HEIGHT_M;
    for (const ring of rings(f)) {
      if (!ring || ring.length < 4) continue;
      out.push([h, ring.map(([x, y]) => [r6(x), r6(y)])]);
    }
  }
  const json = JSON.stringify(out);
  await writeFile(OUT, json);
  console.log(`Wrote ${OUT}: ${out.length} buildings, ${(json.length / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
