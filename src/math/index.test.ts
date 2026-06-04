// src/math/index.test.ts
import { describe, it, expect } from 'vitest';
import {
  bearing,
  midpoint,
  streetLevelWind,
  resistance,
  offsetLonLat,
  computeSegmentLanes,
  computeSegmentCenterWind,
  type SegmentInput,
} from './index';

// Copenhagen city hall — used as a real-world reference point for bearing tests
const CPH = { lon: 12.5683, lat: 55.6761 };

describe('bearing', () => {
  it('returns ~0° for a point due north', () => {
    expect(bearing(CPH, { lon: CPH.lon, lat: CPH.lat + 0.01 })).toBeCloseTo(0, 1);
  });

  it('returns ~90° for a point due east', () => {
    expect(bearing(CPH, { lon: CPH.lon + 0.01, lat: CPH.lat })).toBeCloseTo(90, 1);
  });

  it('returns ~180° for a point due south', () => {
    expect(bearing(CPH, { lon: CPH.lon, lat: CPH.lat - 0.01 })).toBeCloseTo(180, 1);
  });

  it('returns ~270° for a point due west', () => {
    expect(bearing(CPH, { lon: CPH.lon - 0.01, lat: CPH.lat })).toBeCloseTo(270, 1);
  });

  it('returns a value within [0, 360)', () => {
    const b = bearing(CPH, { lon: CPH.lon - 0.01, lat: CPH.lat - 0.01 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  it('applies latitude correction (E-W bearing remains 90° at high latitude)', () => {
    // Without cos(lat) correction, an east-going step at 80°N would register
    // a much smaller bearing because 0.1° of longitude is geographically tiny there.
    const a = { lon: 0, lat: 80 };
    const b = { lon: 0.1, lat: 80 };
    expect(bearing(a, b)).toBeCloseTo(90, 1);
  });
});

describe('midpoint', () => {
  it('returns the componentwise average', () => {
    expect(midpoint({ lon: 0, lat: 0 }, { lon: 2, lat: 4 })).toEqual({ lon: 1, lat: 2 });
  });
});

describe('streetLevelWind', () => {
  it('applies the 0.6 boundary-layer correction', () => {
    expect(streetLevelWind(10)).toBeCloseTo(6, 5);
  });

  it('returns zero for zero input', () => {
    expect(streetLevelWind(0)).toBe(0);
  });
});

describe('resistance', () => {
  const NORTH_10MS = { speedMs: 10, directionDeg: 0 };   // wind FROM the north
  const SOUTH_10MS = { speedMs: 10, directionDeg: 180 }; // wind FROM the south

  it('pure headwind: north-bound street, wind from the north', () => {
    const r = resistance(0, NORTH_10MS);
    expect(r.headwindMs).toBeCloseTo(6, 5); // 10 m/s × 0.6 BL
    expect(r.crosswindMs).toBeCloseTo(0, 5);
  });

  it('pure tailwind: north-bound street, wind from the south', () => {
    const r = resistance(0, SOUTH_10MS);
    expect(r.headwindMs).toBeCloseTo(-6, 5);
    expect(r.crosswindMs).toBeCloseTo(0, 5);
  });

  it('pure crosswind: east-bound street, wind from the north', () => {
    const r = resistance(90, NORTH_10MS);
    expect(r.headwindMs).toBeCloseTo(0, 5);
    expect(r.crosswindMs).toBeCloseTo(6, 5);
  });

  it('zero wind produces zero components', () => {
    const r = resistance(45, { speedMs: 0, directionDeg: 270 });
    expect(r.headwindMs).toBeCloseTo(0, 5);
    expect(r.crosswindMs).toBeCloseTo(0, 5);
  });

  it('45° offset wind splits into equal head and cross components', () => {
    // North-bound street, wind from NE: 45° between wind and street axis
    const r = resistance(0, { speedMs: 10, directionDeg: 45 });
    const expected = 6 * Math.cos(Math.PI / 4); // = 6 * sin(π/4)
    expect(r.headwindMs).toBeCloseTo(expected, 3);
    expect(r.crosswindMs).toBeCloseTo(expected, 3);
  });

  it('handles direction wraparound symmetrically (10° vs 350°)', () => {
    const r1 = resistance(0, { speedMs: 10, directionDeg: 10 });
    const r2 = resistance(0, { speedMs: 10, directionDeg: 350 });
    expect(r1.headwindMs).toBeCloseTo(r2.headwindMs, 5);
    expect(r1.crosswindMs).toBeCloseTo(r2.crosswindMs, 5); // unsigned, so equal
  });
});

const baseSegment = (overrides: Partial<SegmentInput> = {}): SegmentInput => ({
  lon: 12.5683,
  lat: 55.6761,
  bearingDeg: 0,
  segmentLengthM: 50,
  widthM: 18,
  leftDistM: 9,
  rightDistM: 9,
  leftHeightM: 18,
  rightHeightM: 18,
  canyonH: 18,
  canyonW: 18,
  laneOffsetsM: [-7.2, -3.6, 0, 3.6, 7.2],
  geometrySource: 'measured',
  ...overrides,
});

describe('offsetLonLat', () => {
  it('returns midpoint when offset is zero', () => {
    const mid = { lon: 12.5683, lat: 55.6761 };
    expect(offsetLonLat(mid, 0, 0)).toEqual(mid);
  });

  it('offsets laterally perpendicular to bearing', () => {
    const mid = { lon: 12.5683, lat: 55.6761 };
    const left = offsetLonLat(mid, 0, -10);
    expect(left.lon).toBeLessThan(mid.lon);
    expect(left.lat).toBeCloseTo(mid.lat, 4);
  });
});

describe('computeSegmentLanes', () => {
  const northWind = { speedMs: 10, directionDeg: 0 };

  it('returns five lanes', () => {
    const lanes = computeSegmentLanes(baseSegment(), northWind);
    expect(lanes).toHaveLength(5);
  });

  it('symmetric canyon: all lanes have similar speed', () => {
    const lanes = computeSegmentLanes(baseSegment(), northWind);
    const speeds = lanes.map((l) => l.speedMs);
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(2);
  });

  it('asymmetric canyon: edge lanes differ from center', () => {
    const seg = baseSegment({
      leftHeightM: 30,
      rightHeightM: 6,
      canyonH: 18,
    });
    const lanes = computeSegmentLanes(seg, { speedMs: 10, directionDeg: 90 });
    expect(lanes[0].speedMs).not.toBeCloseTo(lanes[4].speedMs, 0);
  });

  it('open field (no buildings): returns ambient-like speeds', () => {
    const seg = baseSegment({
      leftHeightM: 0,
      rightHeightM: 0,
      canyonH: 0,
    });
    const lanes = computeSegmentLanes(seg, northWind);
    for (const lane of lanes) {
      expect(lane.speedMs).toBeCloseTo(10, 1);
    }
  });

  it('center wind matches middle lane', () => {
    const seg = baseSegment();
    const lanes = computeSegmentLanes(seg, northWind);
    const center = computeSegmentCenterWind(seg, northWind);
    expect(center.speedMs).toBeCloseTo(lanes[2].speedMs, 5);
    expect(center.flowDeg).toBeCloseTo(lanes[2].flowDeg, 5);
  });
});