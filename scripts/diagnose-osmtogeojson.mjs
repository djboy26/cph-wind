// scripts/diagnose-osmtogeojson.mjs
// Tests osmtogeojson with a known input to see how it maps OSM tags
// to GeoJSON feature properties. Reveals whether tags are flat or nested.

import osmtogeojson from "osmtogeojson";

const synth = {
  version: 0.6,
  generator: "test",
  elements: [
    { type: "node", id: 1, lat: 55.600, lon: 12.500 },
    { type: "node", id: 2, lat: 55.600, lon: 12.501 },
    { type: "node", id: 3, lat: 55.601, lon: 12.501 },
    { type: "node", id: 4, lat: 55.601, lon: 12.500 },
    {
      type: "way",
      id: 100,
      nodes: [1, 2, 3, 4, 1],
      tags: {
        building: "apartments",
        "building:levels": "5",
        height: "16",
        name: "Test Apartment",
      },
    },
    {
      type: "way",
      id: 101,
      nodes: [1, 2, 3, 4, 1],
      tags: {
        building: "yes",
      },
    },
  ],
};

const gj = osmtogeojson(synth);
console.log("Feature count:", gj.features.length);
for (let i = 0; i < gj.features.length; i++) {
  console.log(`\n=== Feature ${i} ===`);
  console.log("type:", gj.features[i].geometry?.type);
  console.log("properties:");
  console.log(JSON.stringify(gj.features[i].properties, null, 2));
}
