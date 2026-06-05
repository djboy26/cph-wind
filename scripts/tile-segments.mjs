// scripts/tile-segments.mjs
// Splits the monolithic public/data/cph-segments.json (~21.7 MB, all 59.7k streets)
// into a spatial grid of small, lean tiles so the app downloads only the viewport.
//
// Each segment is stored as a compact tuple (derivable/unused fields dropped):
//   [lon, lat, bearingDeg, segLen, leftDist, rightDist, leftH, rightH, geomSrc, wayId]
// widthM / canyonW / canyonH / laneOffsetsM are recomputed in the client.
//
// Output: public/data/segtiles/{col}_{row}.json  (+ index.json manifest)
// Run: node scripts/tile-segments.mjs

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";

const SRC = "public/data/cph-segments.json";
const OUT_DIR = "public/data/segtiles";
// Greater-Copenhagen origin (matches the app's GCPH lock) + tile size in degrees.
const MIN_LON = 12.34;
const MIN_LAT = 55.54;
const TILE_DEG = 0.02; // ~1.3 km cells

const GEOM = { measured: 0, partial: 1, fallback: 2 };

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const r1 = (n) => Math.round(n * 10) / 10;
const r0 = (n) => Math.round(n);

function tileKey(lon, lat) {
  const col = Math.floor((lon - MIN_LON) / TILE_DEG);
  const row = Math.floor((lat - MIN_LAT) / TILE_DEG);
  return `${col}_${row}`;
}

async function main() {
  const t0 = Date.now();
  const segs = JSON.parse(await readFile(SRC, "utf8"));
  console.log(`Loaded ${segs.length} segments from ${SRC}`);

  const tiles = new Map(); // key -> tuple[]
  for (const s of segs) {
    const lon = s.lon, lat = s.lat;
    if (lon == null || lat == null) continue;
    const leftDist = s.leftDistM ?? (s.widthM ?? s.canyonW ?? 0) / 2;
    const rightDist = s.rightDistM ?? (s.widthM ?? s.canyonW ?? 0) / 2;
    const tuple = [
      r6(lon), r6(lat),
      r1(s.bearingDeg ?? 0),
      r1(s.segmentLengthM ?? 30),
      r1(leftDist), r1(rightDist),
      r0(s.leftHeightM ?? s.canyonH ?? 0),
      r0(s.rightHeightM ?? s.canyonH ?? 0),
      GEOM[s.geometrySource] ?? 2,
      s.wayId ?? null,
    ];
    const key = tileKey(lon, lat);
    let arr = tiles.get(key);
    if (!arr) { arr = []; tiles.set(key, arr); }
    arr.push(tuple);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  let total = 0, maxTile = 0;
  const index = [];
  for (const [key, arr] of tiles) {
    const json = JSON.stringify(arr);
    await writeFile(`${OUT_DIR}/${key}.json`, json);
    total += json.length;
    maxTile = Math.max(maxTile, json.length);
    index.push([key, arr.length]);
  }

  const manifest = {
    tileDeg: TILE_DEG,
    minLon: MIN_LON,
    minLat: MIN_LAT,
    fields: ["lon", "lat", "bearingDeg", "segLen", "leftDist", "rightDist", "leftH", "rightH", "geomSrc", "wayId"],
    geom: ["measured", "partial", "fallback"],
    tiles: index.map(([k]) => k),
  };
  await writeFile(`${OUT_DIR}/index.json`, JSON.stringify(manifest));

  console.log(`Wrote ${tiles.size} tiles to ${OUT_DIR}/`);
  console.log(`  total raw: ${(total / 1024 / 1024).toFixed(2)} MB  (was 21.7 MB monolith)`);
  console.log(`  largest tile: ${(maxTile / 1024).toFixed(1)} KB  ·  avg ${(total / tiles.size / 1024).toFixed(1)} KB`);
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
