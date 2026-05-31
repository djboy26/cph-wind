// scripts/fetch-osm.mjs
import { writeFile } from "node:fs/promises";
import osmtogeojson from "osmtogeojson";

const BBOX = "55.58,12.40,55.78,12.75";

const QUERY = `
[out:json][timeout:120];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|cycleway)$"](${BBOX});
  way["highway"="path"]["bicycle"="designated"](${BBOX});
  way["cycleway"](${BBOX});
  way["cycleway:left"](${BBOX});
  way["cycleway:right"](${BBOX});
  way["cycleway:both"](${BBOX});
);
out body;
>;
out skel qt;
`;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OUTPUT_PATH = "public/data/cph-roads.json";

async function main() {
  console.log("Fetching from Overpass...");
  const t0 = Date.now();
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "cph-wind/0.1 (github.com/djboy26/cph-wind)",
      Accept: "*/*",
    },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!response.ok) {
    throw new Error(`Overpass returned ${response.status}: ${await response.text()}`);
  }
  const osm = await response.json();
  console.log(`Fetched in ${((Date.now() - t0) / 1000).toFixed(1)}s. Elements: ${osm.elements.length}`);

  console.log("Converting to GeoJSON...");
  const geojson = osmtogeojson(osm);

  geojson.features = geojson.features.filter((f) => f.geometry.type === "LineString");

  geojson.features = geojson.features.map((f) => {
    const tags = f.properties.tags || {};
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: f.properties.id,
        name: tags.name ?? null,
        highway: tags.highway ?? null,
        cycleway: tags.cycleway ?? null,
      },
    };
  });

  await writeFile(OUTPUT_PATH, JSON.stringify(geojson));
  const sizeMB = (JSON.stringify(geojson).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${geojson.features.length} features to ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
