// scripts/compute-cross-sections.mjs
// Derives street cross-sections from building polygon geometry via perpendicular ray-casts.
import { readFile, writeFile } from "node:fs/promises";
import Flatbush from "flatbush";

const BUILDINGS_PATH = "public/data/cph-buildings.json";
const ROADS_PATH = "public/data/cph-roads.json";
const OUTPUT_PATH = "public/data/cph-segments.json";

const MAX_SEARCH_M = 40;
const MIN_SEGMENT_M = 20;
// A way whose every sub-segment is shorter than MIN_SEGMENT_M gets no arrow at
// all. To still show wind on short streets/cycleways, emit one representative
// segment per such way as long as its longest piece is at least this long
// (skips sub-6m intersection stubs, which would be pure noise).
const MIN_COVERAGE_M = 6;
const CENTROID_FALLBACK_RADIUS_M = 25;

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

const LANE_FRACTIONS = [-0.4, -0.2, 0, 0.2, 0.4];

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

function toLonLat(x, y) {
  return {
    lon: x / MPER_DEG_LON + CPH_LON,
    lat: y / MPER_DEG_LAT + CPH_LAT,
  };
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
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

/** Ray-segment intersection: ray origin O + t*D (t>=0), segment A + u*(B-A) u in [0,1]. */
function raySegmentHit(ox, oy, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return null;

  const t = ((ax - ox) * sy - (ay - oy) * sx) / denom;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / denom;
  if (t < 1e-6 || u < 0 || u > 1) return null;
  return t;
}

function parseOsmWidth(props) {
  const raw = props?.width ?? props?.tags?.width;
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  if (!isNaN(n) && n > 0 && n < 100) return n;
  return null;
}

function laneOffsets(widthM) {
  return LANE_FRACTIONS.map((f) => f * widthM);
}

function extractRings(feature) {
  if (feature.geometry.type === "Polygon") return [feature.geometry.coordinates[0]];
  if (feature.geometry.type === "MultiPolygon") {
    return feature.geometry.coordinates.map((p) => p[0]);
  }
  return [];
}

function castRay(buildings, index, midX, midY, dirX, dirY) {
  const candidates = index.search(
    midX - MAX_SEARCH_M,
    midY - MAX_SEARCH_M,
    midX + MAX_SEARCH_M,
    midY + MAX_SEARCH_M,
  );

  let bestT = Infinity;
  let bestHeight = 0;

  for (const idx of candidates) {
    const b = buildings[idx];
    for (const ring of b.rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const t = raySegmentHit(midX, midY, dirX, dirY, ring[i].x, ring[i].y, ring[i + 1].x, ring[i + 1].y);
        if (t != null && t < bestT && t <= MAX_SEARCH_M) {
          bestT = t;
          bestHeight = b.heightM;
        }
      }
    }
  }

  if (bestT === Infinity) return { distanceM: 0, heightM: 0, hit: false };
  return { distanceM: bestT, heightM: bestHeight, hit: true };
}

function centroidFallbackHeights(index, bX, bY, bH, midX, midY) {
  const candidates = index.search(
    midX - CENTROID_FALLBACK_RADIUS_M,
    midY - CENTROID_FALLBACK_RADIUS_M,
    midX + CENTROID_FALLBACK_RADIUS_M,
    midY + CENTROID_FALLBACK_RADIUS_M,
  );
  let totalH = 0;
  let count = 0;
  for (const idx of candidates) {
    if (dist(bX[idx], bY[idx], midX, midY) <= CENTROID_FALLBACK_RADIUS_M) {
      totalH += bH[idx];
      count++;
    }
  }
  return count > 0 ? totalH / count : 0;
}

async function main() {
  console.log("Loading data...");
  const t0 = Date.now();
  const buildingsGeo = JSON.parse(await readFile(BUILDINGS_PATH, "utf-8"));
  const roads = JSON.parse(await readFile(ROADS_PATH, "utf-8"));
  console.log(
    `Loaded ${buildingsGeo.features.length} buildings, ${roads.features.length} roads in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  console.log("Preparing building polygons...");
  const buildings = [];
  const bX = [];
  const bY = [];
  const bH = [];

  for (const f of buildingsGeo.features) {
    const ringsLonLat = extractRings(f);
    if (ringsLonLat.length === 0) continue;

    const rings = ringsLonLat.map((ring) => ring.map(([lon, lat]) => toLocal(lon, lat)));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cy = 0;
    let n = 0;

    for (const ring of rings) {
      for (const p of ring) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        cx += p.x;
        cy += p.y;
        n++;
      }
    }

    const heightM = f.properties.heightM ?? 9;
    buildings.push({ rings, minX, minY, maxX, maxY, heightM });
    bX.push(cx / n);
    bY.push(cy / n);
    bH.push(heightM);
  }

  console.log("Building spatial indices...");
  const polyIndex = new Flatbush(buildings.length);
  for (const b of buildings) {
    polyIndex.add(b.minX, b.minY, b.maxX, b.maxY);
  }
  polyIndex.finish();

  const centroidIndex = new Flatbush(bX.length);
  for (let i = 0; i < bX.length; i++) {
    centroidIndex.add(bX[i], bY[i], bX[i], bY[i]);
  }
  centroidIndex.finish();

  console.log("Computing per-segment cross-sections...");
  const segments = [];
  const stats = { measured: 0, partial: 0, fallback: 0 };
  let coverageFallbacks = 0;
  let n = 0;

  // Build one segment's cross-section by ray-casting both kerbs from its midpoint.
  // Closes over the spatial indices above; returns the segment record (with its
  // geometrySource set) or null for a degenerate (zero-length) piece.
  function buildSegment(lonA, latA, lonB, latB, segLen, wayId, defaultWidth, osmWidth) {
    const a = toLocal(lonA, latA);
    const b = toLocal(lonB, latB);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const midLonLat = toLonLat(midX, midY);
    const brg = bearingDeg(lonA, latA, lonB, latB);
    const brgRad = (brg * Math.PI) / 180;

    // Left = +90° from travel (west when heading north)
    const leftDirX = -Math.cos(brgRad);
    const leftDirY = Math.sin(brgRad);
    const rightDirX = Math.cos(brgRad);
    const rightDirY = -Math.sin(brgRad);

    const leftHit = castRay(buildings, polyIndex, midX, midY, leftDirX, leftDirY);
    const rightHit = castRay(buildings, polyIndex, midX, midY, rightDirX, rightDirY);

    let leftDist = leftHit.hit ? leftHit.distanceM : 0;
    let rightDist = rightHit.hit ? rightHit.distanceM : 0;
    let leftHeightM = leftHit.hit ? leftHit.heightM : 0;
    let rightHeightM = rightHit.hit ? rightHit.heightM : 0;

    let geometrySource;
    if (leftHit.hit && rightHit.hit) {
      geometrySource = "measured";
    } else if (leftHit.hit || rightHit.hit) {
      geometrySource = "partial";
      const half = (osmWidth ?? defaultWidth) / 2;
      if (!leftHit.hit) {
        leftDist = rightHit.hit ? rightDist : half;
        leftHeightM = rightHeightM;
      }
      if (!rightHit.hit) {
        rightDist = leftHit.hit ? leftDist : half;
        rightHeightM = leftHeightM;
      }
    } else {
      geometrySource = "fallback";
      const fallbackH = centroidFallbackHeights(centroidIndex, bX, bY, bH, midX, midY);
      const widthM = osmWidth ?? defaultWidth;
      leftDist = widthM / 2;
      rightDist = widthM / 2;
      leftHeightM = fallbackH;
      rightHeightM = fallbackH;
    }

    const widthM = leftDist + rightDist;
    const canyonH = (leftHeightM + rightHeightM) / 2;

    return {
      wayId,
      lon: midLonLat.lon,
      lat: midLonLat.lat,
      bearingDeg: brg,
      segmentLengthM: segLen,
      widthM,
      leftDistM: leftDist,
      rightDistM: rightDist,
      leftHeightM,
      rightHeightM,
      canyonH,
      canyonW: widthM,
      laneOffsetsM: laneOffsets(widthM),
      geometrySource,
    };
  }

  for (const feature of roads.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    const highway = feature.properties.highway || "default";
    const defaultWidth = WIDTHS[highway] ?? DEFAULT_WIDTH;
    const osmWidth = parseOsmWidth(feature.properties);
    const wayId = feature.properties.id;

    let featureCount = 0;
    let longest = null; // the longest sub-segment seen, for the coverage fallback

    for (let i = 0; i < coords.length - 1; i++) {
      const [lonA, latA] = coords[i];
      const [lonB, latB] = coords[i + 1];
      const a = toLocal(lonA, latA);
      const b = toLocal(lonB, latB);
      const segLen = dist(a.x, a.y, b.x, b.y);
      if (!longest || segLen > longest.segLen) longest = { lonA, latA, lonB, latB, segLen };
      if (segLen < MIN_SEGMENT_M) continue;

      const s = buildSegment(lonA, latA, lonB, latB, segLen, wayId, defaultWidth, osmWidth);
      segments.push(s);
      stats[s.geometrySource]++;
      featureCount++;

      n++;
      if (n % 20000 === 0) console.log(`  ${n} segments...`);
    }

    // Coverage fallback: ways with no long-enough piece still get one arrow.
    if (featureCount === 0 && longest && longest.segLen >= MIN_COVERAGE_M) {
      const s = buildSegment(longest.lonA, longest.latA, longest.lonB, longest.latB, longest.segLen, wayId, defaultWidth, osmWidth);
      segments.push(s);
      stats[s.geometrySource]++;
      coverageFallbacks++;
      n++;
    }
  }

  console.log(`Total segments: ${segments.length}`);
  console.log(`  (incl. ${coverageFallbacks} coverage fallbacks for short ways)`);
  console.log("Geometry sources:");
  console.log(`  measured: ${stats.measured}`);
  console.log(`  partial:  ${stats.partial}`);
  console.log(`  fallback: ${stats.fallback}`);

  const lambdas = segments.map((s) => (s.widthM > 0 ? s.canyonH / s.widthM : 0));
  const buckets = { none: 0, shallow: 0, moderate: 0, deep: 0 };
  for (const l of lambdas) {
    if (l < 0.1) buckets.none++;
    else if (l < 0.3) buckets.shallow++;
    else if (l < 0.7) buckets.moderate++;
    else buckets.deep++;
  }
  console.log("Canyon distribution:");
  console.log(`  None (lambda<0.1):     ${buckets.none}`);
  console.log(`  Shallow (0.1-0.3):     ${buckets.shallow}`);
  console.log(`  Moderate (0.3-0.7):    ${buckets.moderate}`);
  console.log(`  Deep (lambda>0.7):     ${buckets.deep}`);

  await writeFile(OUTPUT_PATH, JSON.stringify(segments));
  const sizeMB = (JSON.stringify(segments).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUTPUT_PATH} (${sizeMB} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
