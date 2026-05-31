// scripts/fetch-buildings.mjs
import { writeFile } from "node:fs/promises";
import osmtogeojson from "osmtogeojson";

const BBOX = "55.58,12.40,55.78,12.75";

const QUERY = `
[out:json][timeout:180];
(
  way["building"](${BBOX});
  relation["building"](${BBOX});
);
out body;
>;
out skel qt;
`;

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OUTPUT_PATH = "public/data/cph-buildings.json";

const DEFAULT_LEVEL_HEIGHT_M = 3.0;
const DEFAULT_HEIGHT_BY_TYPE = {
  apartments: 15,
  residential: 9,
  house: 6,
  detached: 6,
  semidetached_house: 6,
  terrace: 9,
  commercial: 12,
  office: 18,
  retail: 6,
  industrial: 9,
  warehouse: 9,
  church: 18,
  cathedral: 30,
  school: 12,
  university: 18,
  hospital: 18,
  hotel: 18,
  default: 9,
};

function inferHeight(props) {
  // osmtogeojson v3 nests OSM tags under properties.tags
  const tags = props.tags || props;
  if (tags.height) {
    const n = parseFloat(tags.height);
    if (!isNaN(n) && n > 0 && n < 500) return n;
  }
  if (tags["building:levels"]) {
    const n = parseFloat(tags["building:levels"]);
    if (!isNaN(n) && n > 0 && n < 100) return n * DEFAULT_LEVEL_HEIGHT_M;
  }
  const type = tags.building;
  return DEFAULT_HEIGHT_BY_TYPE[type] ?? DEFAULT_HEIGHT_BY_TYPE.default;
}

async function main() {
  console.log("Fetching buildings from Overpass...");
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

  geojson.features = geojson.features.filter(
    (f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon",
  );

  // Track how heights are derived for diagnostics
  let fromHeight = 0, fromLevels = 0, fromType = 0;

  geojson.features = geojson.features.map((f) => {
    const tags = f.properties.tags || {};
    let h, src;
    if (tags.height && !isNaN(parseFloat(tags.height))) {
      h = parseFloat(tags.height);
      src = "height";
      fromHeight++;
    } else if (tags["building:levels"] && !isNaN(parseFloat(tags["building:levels"]))) {
      h = parseFloat(tags["building:levels"]) * DEFAULT_LEVEL_HEIGHT_M;
      src = "levels";
      fromLevels++;
    } else {
      h = DEFAULT_HEIGHT_BY_TYPE[tags.building] ?? DEFAULT_HEIGHT_BY_TYPE.default;
      src = "type";
      fromType++;
    }
    return {
      type: "Feature",
      geometry: f.geometry,
      properties: { id: f.properties.id, heightM: h, hSrc: src },
    };
  });

  console.log(`Height sources: explicit=${fromHeight}, levels=${fromLevels}, type-default=${fromType}`);
  await writeFile(OUTPUT_PATH, JSON.stringify(geojson));
  const sizeMB = (JSON.stringify(geojson).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${geojson.features.length} buildings to ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
