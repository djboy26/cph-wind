// src/layers/buildWindArrows.ts
// Expands street segments into wind-vector arrows confined to the carriageway.
//
// Per segment we compute ONE local wind vector (the 3D-canyon-modified wind at the
// street, from computeSegmentCenterWind). We then sample it across a small grid
// that tiles only the carriageway — N rows along the street × 5 lateral lanes —
// so every arrow on a segment points in that segment's true local wind direction.
//
// The carriageway width is derived from the OSM highway class, NOT the canyon
// (building-to-building) width — that distinction is what keeps arrows on the road.

import { windBandColor } from '../cyclist/windCategory';
import {
  computeSegmentCenterWind,
  type GeometrySource,
  type SegmentInput,
  type Wind,
} from '../math';
import type { WindArrowInstance } from './WindFlowLayer';

export interface RawSegment extends SegmentInput {
  wayId: string | number | undefined;
  /** Carriageway width (meters) derived from the highway class. Falls back to a clamp. */
  roadWidthM?: number;
}

export type ArrowDensity = 'hidden' | 'single' | 'multi';

export function arrowDensityForZoom(zoom: number): ArrowDensity {
  if (zoom < 13) return 'hidden';
  if (zoom < 16) return 'single';
  return 'multi';
}

// --- Carriageway widths by OSM highway class (meters, paved width incl. parking) ---
const ROAD_WIDTHS: Record<string, number> = {
  motorway: 16, motorway_link: 8,
  trunk: 14, trunk_link: 8,
  primary: 14, primary_link: 8,
  secondary: 12, secondary_link: 7,
  tertiary: 9, tertiary_link: 6,
  unclassified: 7,
  residential: 7,
  living_street: 6,
  service: 5,
  pedestrian: 6,
  footway: 3,
  path: 3,
  cycleway: 3,
  construction: 6,
};
const DEFAULT_ROAD_WIDTH = 7;

/** Carriageway width: the highway-class width, but never wider than the building gap. */
export function roadWidthForHighway(highway: string | undefined, canyonWidthM: number): number {
  const w = ROAD_WIDTHS[highway ?? ''] ?? DEFAULT_ROAD_WIDTH;
  return Math.max(2.5, Math.min(w, canyonWidthM || w));
}

const DEG = Math.PI / 180;

const ROW_SPACING_M = 7;
const MAX_ROWS = 200;
// Lateral lane fractions of the carriageway width (5 across, central 64%).
const LANE_FRACTIONS = [-0.32, -0.16, 0, 0.16, 0.32];
// Cross-street drift allowance as a fraction of carriageway width (keeps particles in lane).
const CROSS_MARGIN_FRACTION = 0.12;
const ARROW_WIDTH_FRACTION = 0.16;
const MIN_ARROW_M = 0.5;
const MAX_ARROW_M = 3.5;
const SPEED_REF = 4;
const MIN_SPEED_FACTOR = 0.25;
const MAX_SPEED_FACTOR = 2.5;
// Gust amplitude cap (keeps the drift-rate warp strictly increasing).
const MAX_GUST_BOOST = 0.9;
// Along-street wavelength of a gust front (m): nearby arrows share a phase so a
// gust visibly sweeps down the road rather than every arrow pulsing together.
const GUST_WAVELENGTH_M = 45;
// Golden-ratio increment so consecutive segments gust out of sync.
const GUST_PHASE_STEP = 0.6180339887498949;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function normalizeSegment(seg: RawSegment): SegmentInput {
  const widthM = seg.widthM ?? seg.canyonW;
  const leftDistM = seg.leftDistM ?? widthM / 2;
  const rightDistM = seg.rightDistM ?? widthM / 2;
  return {
    ...seg,
    widthM,
    leftDistM,
    rightDistM,
    leftHeightM: seg.leftHeightM ?? seg.canyonH,
    rightHeightM: seg.rightHeightM ?? seg.canyonH,
    laneOffsetsM: seg.laneOffsetsM ?? [-0.4, -0.2, 0, 0.2, 0.4].map((f) => f * widthM),
    geometrySource: (seg.geometrySource ?? 'fallback') as GeometrySource,
  };
}

/** Max along-flow travel so the particle stays within its cell (along + across bounds). */
function boundedTravel(flowDeg: number, bearingDeg: number, alongCellM: number, crossMarginM: number): number {
  const rel = (flowDeg - bearingDeg) * DEG;
  const along = Math.abs(Math.cos(rel));
  const cross = Math.abs(Math.sin(rel));
  const byAlong = alongCellM / Math.max(along, 1e-3);
  const byCross = (2 * crossMarginM) / Math.max(cross, 1e-3);
  return clamp(Math.min(byAlong, byCross), 0, alongCellM * 1.5);
}

export function buildWindArrows(
  segments: RawSegment[],
  wind: Wind,
  density: ArrowDensity,
): WindArrowInstance[] {
  if (density === 'hidden') return [];

  const out: WindArrowInstance[] = [];

  for (let i = 0; i < segments.length; i++) {
    const raw = segments[i];
    const seg = normalizeSegment(raw);
    const roadW = raw.roadWidthM ?? roadWidthForHighway(undefined, seg.widthM);

    // One local wind vector for the whole segment (3D-canyon-modified).
    const lane = computeSegmentCenterWind(seg, wind);
    const [cr, cg, cb] = windBandColor(lane.speedMs);
    const speedFactor = clamp(lane.speedMs / SPEED_REF, MIN_SPEED_FACTOR, MAX_SPEED_FACTOR);
    // Gust amplitude (gust/mean − 1) drives the surge animation; 0 ⇒ steady flow.
    const gustBoost =
      lane.gustMs && lane.speedMs > 0.3
        ? clamp(lane.gustMs / lane.speedMs - 1, 0, MAX_GUST_BOOST)
        : 0;
    const segGustPhase = (i * GUST_PHASE_STEP) % 1;
    const arrowSizeM = clamp(roadW * ARROW_WIDTH_FRACTION, MIN_ARROW_M, MAX_ARROW_M);
    const crossMarginM = roadW * CROSS_MARGIN_FRACTION;

    const segLen = seg.segmentLengthM ?? 30;
    const lanes = density === 'multi' ? LANE_FRACTIONS : [0];
    const rows = density === 'multi' ? clamp(Math.round(segLen / ROW_SPACING_M), 1, MAX_ROWS) : 1;
    const spacing = rows > 0 ? segLen / rows : segLen;
    const travelLenM = boundedTravel(lane.flowDeg, seg.bearingDeg, spacing, crossMarginM);

    for (let r = 0; r < rows; r++) {
      const baseAlongM = density === 'multi' ? (r - (rows - 1) / 2) * spacing : 0;
      for (let li = 0; li < lanes.length; li++) {
        out.push({
          segmentId: i,
          wayId: raw.wayId,
          lon: seg.lon,
          lat: seg.lat,
          bearingDeg: seg.bearingDeg,
          offsetM: lanes[li] * roadW,
          baseAlongM,
          flowDeg: lane.flowDeg,
          travelLenM,
          // Stagger phase across rows and lanes so the grid does not pulse in unison.
          phase0: (r * 0.37 + li * 0.19) % 1,
          speedFactor,
          arrowSizeM,
          speedMs: lane.speedMs,
          gustMs: lane.gustMs,
          gustBoost,
          // Offset the gust phase along the street so a gust front sweeps the road.
          gustSeed: segGustPhase + baseAlongM / GUST_WAVELENGTH_M,
          color: [cr, cg, cb],
          laneIndex: li,
          laneCount: lanes.length,
          widthM: seg.widthM,
          leftHeightM: seg.leftHeightM,
          rightHeightM: seg.rightHeightM,
          leftDistM: seg.leftDistM,
          rightDistM: seg.rightDistM,
          canyonH: seg.canyonH,
          canyonW: seg.canyonW,
          geometrySource: seg.geometrySource,
        });
      }
    }
  }

  return out;
}
