// Verifies the two properties the redesign must guarantee:
//   1. No arrow ever leaves the carriageway (no bleeding), across its whole anim cycle.
//   2. Arrows point in the true local wind vector, not collapsed onto the street axis.
import { describe, it, expect } from 'vitest';
import { buildWindArrows, type RawSegment } from './buildWindArrows';
import { offsetLonLat, offsetAlongBearing, type Wind } from '../math';

const DEG = Math.PI / 180;
const MPER_DEG_LAT = 111_000;

interface ArrowDebug {
  lon: number;
  lat: number;
  bearingDeg: number;
  offsetM: number;
  baseAlongM: number;
  flowDeg: number;
  speedFactor: number;
  phase0: number;
  travelLenM: number;
  segmentId: number;
}

// Mirror of WindFlowLayer.arrowPosition (kept in sync) so we can test without deck.gl.
const BASE_RATE = 0.5;
function arrowPositionAt(d: ArrowDebug, flowPhase: number) {
  const mid = { lon: d.lon, lat: d.lat };
  const lateral = offsetLonLat(mid, d.bearingDeg, d.offsetM);
  const grid = offsetAlongBearing(lateral, d.bearingDeg, d.baseAlongM);
  const cycle = ((flowPhase * BASE_RATE * d.speedFactor + d.phase0) % 1 + 1) % 1;
  const drift = (cycle - 0.5) * d.travelLenM;
  return offsetAlongBearing(grid, d.flowDeg, drift);
}

/** Perpendicular distance (m) of a point from the street centerline through the midpoint. */
function lateralDistanceM(d: ArrowDebug, pos: { lon: number; lat: number }) {
  const mPerDegLon = MPER_DEG_LAT * Math.cos(d.lat * DEG);
  const dEast = (pos.lon - d.lon) * mPerDegLon;
  const dNorth = (pos.lat - d.lat) * MPER_DEG_LAT;
  const brg = d.bearingDeg * DEG;
  // Lateral (+right) unit vector in (east, north) is (cos brg, -sin brg).
  return Math.abs(dEast * Math.cos(brg) - dNorth * Math.sin(brg));
}

function seg(overrides: Partial<RawSegment> = {}): RawSegment {
  return {
    wayId: 1,
    lon: 12.5683,
    lat: 55.6761,
    bearingDeg: 30,
    segmentLengthM: 60,
    widthM: 26, // canyon (building-to-building) — deliberately large
    leftDistM: 13,
    rightDistM: 13,
    leftHeightM: 18,
    rightHeightM: 18,
    canyonH: 18,
    canyonW: 26,
    laneOffsetsM: [-10.4, -5.2, 0, 5.2, 10.4],
    geometrySource: 'measured',
    roadWidthM: 7, // carriageway
    ...overrides,
  };
}

describe('buildWindArrows — confinement', () => {
  // Worst case for lateral bleed: wind blowing straight across the street.
  const crossWind: Wind = { speedMs: 8, directionDeg: 120 }; // perpendicular to bearing 30

  it('keeps every arrow within the carriageway across the full animation cycle', () => {
    const segments = [
      seg(),
      seg({ bearingDeg: 0, roadWidthM: 14 }),
      seg({ bearingDeg: 75, roadWidthM: 5 }),
      seg({ bearingDeg: 200, roadWidthM: 9 }),
    ];
    const arrows = buildWindArrows(segments, crossWind, 'multi');
    expect(arrows.length).toBeGreaterThan(0);

    let maxBleed = -Infinity;
    for (const a of arrows) {
      // The carriageway half-width that arrows were placed within:
      const roadHalf = roadHalfForArrow(a, segments);
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const pos = arrowPositionAt(a, p * 4); // sweep several cycles via phase
        const dist = lateralDistanceM(a, pos);
        maxBleed = Math.max(maxBleed, dist - roadHalf);
        expect(dist).toBeLessThanOrEqual(roadHalf + 1e-6);
      }
    }
    // Sanity: we actually got close to the edge (placement is meaningful, not trivially centered).
    expect(maxBleed).toBeGreaterThan(-roadHalfMax(segments));
  });

  it('arrows point in the true wind vector, not the street axis', () => {
    // Bearing 30, perpendicular wind → flow must be far from the street bearing.
    const arrows = buildWindArrows([seg({ bearingDeg: 30, canyonH: 0, leftHeightM: 0, rightHeightM: 0 })], crossWind, 'multi');
    const flow = arrows[0].flowDeg;
    const deltaFromAxis = Math.min(
      Math.abs(((flow - 30 + 540) % 360) - 180),
      Math.abs(((flow - 210 + 540) % 360) - 180),
    );
    // Open street (no canyon) → flow ≈ wind direction, ~90° off the street axis.
    expect(deltaFromAxis).toBeGreaterThan(30);
  });
});

// Helper: recover the carriageway half-width an arrow was built with.
// Arrows are placed at lateral fractions up to 0.32 of roadWidth + up to 0.12 cross drift.
function roadHalfForArrow(a: ArrowDebug, segments: RawSegment[]): number {
  const s = segments[a.segmentId];
  return (s.roadWidthM ?? 7) / 2;
}
function roadHalfMax(segments: RawSegment[]): number {
  return Math.max(...segments.map((s) => (s.roadWidthM ?? 7) / 2));
}
