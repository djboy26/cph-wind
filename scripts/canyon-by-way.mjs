// scripts/canyon-by-way.mjs
// The per-way canyon table the router joins on: { wayId: [[startM, heightM, widthM], …] },
// derived from the committed tiles so it never needs Overpass or the untracked
// cph-segments.json. Run: node scripts/canyon-by-way.mjs  (npm run data:canyon)
import { readFile, writeFile } from "node:fs/promises";

const DIR = "public/data/segtiles";
const OUT = "public/data/canyon-by-way.json";

const manifest = JSON.parse(await readFile(`${DIR}/index.json`, "utf8"));
const F = Object.fromEntries(manifest.fields.map((name, i) => [name, i]));
const r1 = (x) => Math.round(x * 10) / 10;

const byWay = new Map();
let pieces = 0;
for (const key of manifest.tiles) {
  for (const t of JSON.parse(await readFile(`${DIR}/${key}.json`, "utf8"))) {
    const wayId = String(t[F.wayId]);
    const row = [t[F.startM], r1((t[F.leftH] + t[F.rightH]) / 2), r1(t[F.leftDist] + t[F.rightDist])];
    let rows = byWay.get(wayId);
    if (!rows) byWay.set(wayId, (rows = []));
    rows.push(row);
    pieces++;
  }
}
const out = {};
for (const [wayId, rows] of byWay) out[wayId] = rows.sort((a, b) => a[0] - b[0]);
const json = JSON.stringify(out);
await writeFile(OUT, json);
console.log(`${byWay.size} ways, ${pieces} pieces, ${(json.length / 1e6).toFixed(2)} MB -> ${OUT}`);
