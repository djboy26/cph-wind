// scripts/validate-cross-sections.mjs
// Samples segments and flags cross-section outliers.
import { readFile } from "node:fs/promises";

const SEGMENTS_PATH = "public/data/cph-segments.json";
const SAMPLE_COUNT = 20;
const MIN_WIDTH = 3;
const MAX_WIDTH = 60;

async function main() {
  const segments = JSON.parse(await readFile(SEGMENTS_PATH, "utf-8"));
  console.log(`Loaded ${segments.length} segments`);

  const required = [
    "widthM", "leftDistM", "rightDistM", "leftHeightM", "rightHeightM",
    "laneOffsetsM", "geometrySource", "segmentLengthM",
  ];
  const missing = segments.filter((s) => required.some((k) => s[k] === undefined));
  if (missing.length > 0) {
    console.error(`FAIL: ${missing.length} segments missing required fields`);
    process.exit(1);
  }
  console.log("All segments have required cross-section fields.");

  const outliers = segments.filter((s) => s.widthM < MIN_WIDTH || s.widthM > MAX_WIDTH);
  console.log(`Width outliers (<${MIN_WIDTH}m or >${MAX_WIDTH}m): ${outliers.length}`);

  const sources = { measured: 0, partial: 0, fallback: 0 };
  for (const s of segments) sources[s.geometrySource] = (sources[s.geometrySource] ?? 0) + 1;
  console.log("Geometry sources:", sources);

  const indices = new Set();
  while (indices.size < Math.min(SAMPLE_COUNT, segments.length)) {
    indices.add(Math.floor(Math.random() * segments.length));
  }

  console.log(`\nRandom sample (${indices.size} segments):`);
  for (const i of indices) {
    const s = segments[i];
    console.log(
      `  wayId=${s.wayId} W=${s.widthM.toFixed(1)}m L=${s.leftDistM.toFixed(1)}/${s.rightDistM.toFixed(1)} ` +
      `H=${s.leftHeightM.toFixed(0)}/${s.rightHeightM.toFixed(0)} src=${s.geometrySource}`,
    );
  }

  const avgW =
    segments.reduce((sum, s) => sum + s.widthM, 0) / segments.length;
  console.log(`\nMean street width: ${avgW.toFixed(1)} m`);
  console.log("Validation complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
