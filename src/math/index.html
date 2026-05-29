// src/math/index.test.ts
import { describe, it, expect } from 'vitest';
import { bearing, midpoint, streetLevelWind, resistance } from './index';

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