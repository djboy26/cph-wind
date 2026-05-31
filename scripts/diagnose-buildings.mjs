// scripts/diagnose-buildings.mjs
// Inspects raw OSM tags vs osmtogeojson output for central Copenhagen buildings.
// Uses the kumi mirror to avoid rate limits.

import osmtogeojson from "osmtogeojson";

const OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter";

const QUERY = `
[out:json][timeout:30];
(way["building"](55.677,12.567,55.685,12.580););
out body;
>;
out skel qt;
`;

const r = await fetch(OVERPASS_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "cph-wind/0.1",
    Accept: "*/*",
  },
  body: "data=" + encodeURIComponent(QUERY),
});

const text = await r.text();
if (!r.ok || text.trim().startsWith("<")) {
  console.error(`HTTP ${r.status}`);
  console.error(text.slice(0, 800));
  process.exit(1);
}

const osm = JSON.parse(text);
console.log(`Got ${osm.elements.length} elements`);

console.log("\n=== RAW OSM (first 5 way elements with tags) ===");
const ways = osm.elements.filter((e) => e.type === "way" && e.tags).slice(0, 5);
for (const w of ways) {
  console.log(JSON.stringify(w.tags, null, 2));
  console.log("---");
}

console.log("\n=== AFTER osmtogeojson (first 5 polygon features) ===");
const gj = osmtogeojson(osm);
const polys = gj.features
  .filter(
    (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
  )
  .slice(0, 5);
for (const f of polys) {
  console.log(JSON.stringify(f.properties, null, 2));
  console.log("---");
}
