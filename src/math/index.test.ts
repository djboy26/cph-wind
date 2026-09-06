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
  canyonModifiedWind,
  type SegmentInput,
  type CanyonGeometry,
} from './index';

// Copenhagen city hall — used as a real-world reference point for bearing tests
const CPH = { lon: 12.5683, lat: 55.6761 };

const DEG = Math.PI / 180;

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
    // The two walls give the two edge lanes different local λ (1.53 and 0.47), so their
    // flow vectors differ. Compared as vectors, not speeds: since Step 8 the deep side's
    // cross flow is reversed, so the speeds can agree while the directions oppose.
    const vec = (l: (typeof lanes)[number]) => [l.speedMs * Math.sin(l.flowDeg * DEG), l.speedMs * Math.cos(l.flowDeg * DEG)];
    const [ax, ay] = vec(lanes[0]);
    const [bx, by] = vec(lanes[4]);
    expect(Math.hypot(ax - bx, ay - by)).toBeGreaterThan(0.5);
  });

  it('open field (no buildings): returns the boundary-layer-reduced ambient', () => {
    const seg = baseSegment({
      leftHeightM: 0,
      rightHeightM: 0,
      canyonH: 0,
    });
    const lanes = computeSegmentLanes(seg, northWind);
    for (const lane of lanes) {
      // 10 m/s at the 10 m met reference is 6 m/s at rider height. Before step 2a
      // this path returned the raw 10 m value, which is what made the map arrows
      // and the route panel disagree.
      expect(lane.speedMs).toBeCloseTo(6, 1);
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
// ---------------------------------------------------------------------------
// Step 2a: the canyon model must not manufacture energy. Street-level wind
// inside an urban canopy should never exceed the open-terrain 10 m reference.
// ---------------------------------------------------------------------------

describe('canyonModifiedWind — energy budget', () => {
  const LAMBDAS = [0, 0.1, 0.34, 0.65, 1.0, 1.5, 2.5];
  const geom = (lambda: number): CanyonGeometry => ({ heightM: lambda * 20, widthM: 20 });

  it('never returns more wind than the ambient it was given', () => {
    const ambientSpeed = 8;
    const offenders: string[] = [];
    let worst = 0;

    for (const lambda of LAMBDAS) {
      for (let windDeg = 0; windDeg < 360; windDeg += 10) {
        for (let streetDeg = 0; streetDeg < 360; streetDeg += 10) {
          const out = canyonModifiedWind(streetDeg, geom(lambda), {
            speedMs: ambientSpeed,
            directionDeg: windDeg,
          });
          const ratio = out.speedMs / ambientSpeed;
          if (ratio > worst) worst = ratio;
          if (out.speedMs > ambientSpeed + 1e-9) {
            offenders.push(
              `λ=${lambda} street=${streetDeg}° wind=${windDeg}° -> ` +
                `${out.speedMs.toFixed(3)} m/s (${ratio.toFixed(3)}× ambient)`,
            );
          }
        }
      }
    }

    expect(
      offenders.length,
      `${offenders.length} of ${LAMBDAS.length * 36 * 36} combinations exceed ambient ` +
        `(worst ${worst.toFixed(3)}× ambient). First few:\n${offenders.slice(0, 6).join('\n')}`,
    ).toBe(0);
  });
});

describe('canyonModifiedWind — boundary layer', () => {
  // An aligned street: bearing 0 (N-S) with the wind coming from the north, so
  // the whole vector is along-canyon and the along factor acts undiluted.
  // λ = 0.34 is the measured Copenhagen median. alongFactor = 1 + 0.3 × 0.34
  // = 1.102, so the answer is 3.9 × 0.6 × 1.102 = 2.579 m/s. Before the fix this
  // returned 3.9 × 1.102 = 4.298 m/s — above the ambient it was given.
  it('scales an aligned median canyon to 2.58 m/s, not 4.30', () => {
    const out = canyonModifiedWind(
      0,
      { heightM: 6.8, widthM: 20 },
      { speedMs: 3.9, directionDeg: 0 },
    );
    expect(out.speedMs).toBeCloseTo(2.58, 2);
    expect(Math.abs(out.speedMs - 2.58)).toBeLessThanOrEqual(0.01);
    expect(out.speedMs).not.toBeCloseTo(4.3, 1); // the pre-fix value
  });

  it('reduces on the λ < 0.1 early-return path instead of returning raw ambient', () => {
    const ambient = { speedMs: 7, directionDeg: 215, gustMs: 12 };
    // widthM 100 / heightM 4 gives λ = 0.04: wide enough that no canyon transform
    // applies, which is ~16% of central segments.
    const out = canyonModifiedWind(35, { heightM: 4, widthM: 100 }, ambient);
    expect(out.speedMs).toBeCloseTo(4.2, 6); // 7 × 0.6, not 7
    expect(out.speedMs).not.toBeCloseTo(ambient.speedMs, 1);
    expect(out.directionDeg).toBeCloseTo(215, 6); // no channeling, so no rotation
    expect(out.gustMs).toBeCloseTo(7.2, 6); // gust reduced by the same factor

    // Zero-width geometry takes the same path (λ falls back to 0).
    expect(canyonModifiedWind(35, { heightM: 0, widthM: 0 }, ambient).speedMs).toBeCloseTo(4.2, 6);
  });

  it('agrees with resistance() on an aligned street once channeling is removed', () => {
    // λ just under the 0.1 cutoff means no canyon transform, so the canyon path
    // and the routing path should now see the same street-level wind. This is the
    // gap step 2a closes; the residual difference at real λ is the channeling.
    const ambient = { speedMs: 6, directionDeg: 0 };
    const canyon = canyonModifiedWind(0, { heightM: 1, widthM: 100 }, ambient);
    const router = resistance(0, ambient); // aligned street, pure headwind
    expect(canyon.speedMs).toBeCloseTo(Math.abs(router.headwindMs), 9);
  });

  it('applies streetLevelWind exactly once per code path', () => {
    // A double application would land at 0.36 × ambient rather than 0.6 ×.
    const ambient = { speedMs: 10, directionDeg: 0 };
    const open = canyonModifiedWind(0, { heightM: 0, widthM: 20 }, ambient);
    expect(open.speedMs).toBeCloseTo(6, 9);
    expect(open.speedMs).not.toBeCloseTo(3.6, 1);

    // resistance() and alongStreetWind() reduce on their own and must not also
    // route through the canyon model, or they would compound.
    expect(Math.abs(resistance(0, ambient).headwindMs)).toBeCloseTo(6, 9);
  });
});

describe('canyonModifiedWind — vortex (step 8)', () => {
  // Street bearing 0 (north–south), ambient 8 m/s, so the rider-height reference is
  // v = 8 × 0.6 = 4.8 m/s. λ from heightM / widthM with widthM fixed at 10.
  const U = 8;
  const v = U * 0.6;
  const geom = (lambda: number): CanyonGeometry => ({ heightM: lambda * 10, widthM: 10 });
  const crossX = (out: { speedMs: number; directionDeg: number }) =>
    out.speedMs * Math.sin(((out.directionDeg + 180) % 360) * DEG);

  it('λ = 1, wind straight across from the east: felt from the west at 0.4 v', () => {
    const out = canyonModifiedWind(0, geom(1), { speedMs: U, directionDeg: 90 });
    expect(Math.abs(out.directionDeg - 270)).toBeLessThan(1);
    expect(out.speedMs).toBeCloseTo(v * 0.4, 9);
  });

  it('λ = 0.3, wind from the east: the old blockage, unchanged', () => {
    const out = canyonModifiedWind(0, geom(0.3), { speedMs: U, directionDeg: 90 });
    expect(Math.abs(out.directionDeg - 90)).toBeLessThan(1);
    expect(out.speedMs).toBeCloseTo(v * Math.exp(-1.8 * 0.3), 9);
  });

  it('λ = 0.5, the foot of the blend: identical to the old formula', () => {
    const out = canyonModifiedWind(0, geom(0.5), { speedMs: U, directionDeg: 90 });
    expect(Math.abs(out.directionDeg - 90)).toBeLessThan(1);
    expect(out.speedMs).toBeCloseTo(v * Math.exp(-1.8 * 0.5), 9);
  });

  it('λ = 1.2, wind from 45°: channelled along, reversed across', () => {
    // Travel vector of the ambient at rider height: (−v/√2, −v/√2). Along the street
    // (bearing 0) that is −v/√2, scaled by 1 + 0.3 × 1.2; across it −v/√2, scaled by −0.4.
    const along = -Math.SQRT1_2 * v * (1 + 0.3 * 1.2);
    const cross = -Math.SQRT1_2 * v * -0.4;
    const out = canyonModifiedWind(0, geom(1.2), { speedMs: U, directionDeg: 45 });
    expect(out.speedMs).toBeCloseTo(Math.hypot(along, cross), 6);
    const travelDeg = (Math.atan2(cross, along) / DEG + 360) % 360; // ≈ 163.6
    expect(Math.abs(out.directionDeg - ((travelDeg + 180) % 360))).toBeLessThan(0.1); // ≈ 343.6
  });

  it('the cross component moves smoothly through the sign change', () => {
    let prev: number | null = null;
    let worst = 0;
    for (let lambda = 0.3; lambda <= 1.2001; lambda += 0.01) {
      const x = crossX(canyonModifiedWind(0, geom(lambda), { speedMs: U, directionDeg: 90 }));
      if (prev !== null) worst = Math.max(worst, Math.abs(x - prev));
      prev = x;
    }
    // The blend's steepest slope is ~4 per unit λ on a 0.8-wide swing of v: ~0.19 m/s per
    // 0.01 step. A hard flip would be a ~2 m/s jump.
    expect(worst).toBeLessThan(0.25);
  });
});
