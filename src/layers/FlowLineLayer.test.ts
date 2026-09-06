// src/layers/FlowLineLayer.test.ts
// The arrow lattice the app renders (step 5f): rows across and columns along every
// road at fixed 3 m points in the road's own frame, thinned by zoom to a subset,
// deterministic contention, one glyph length, opacity by strength, and the one
// property kept from the deleted buildWindArrows tests: arrows point in the true wind
// vector, not along the street.
import { describe, it, expect } from 'vitest';
import { buildFlowField, roadWidthM } from './FlowLineLayer';
import type { RawSegment } from './buildWindArrows';
import { offsetAlongBearing, type Wind } from '../math';

function seg(overrides: Partial<RawSegment> = {}): RawSegment {
  return {
    wayId: 1,
    startM: 0,
    classRank: 3,
    lon: 12.5683,
    lat: 55.6761,
    bearingDeg: 30,
    segmentLengthM: 60,
    widthM: 26,
    leftDistM: 13,
    rightDistM: 13,
    leftHeightM: 18,
    rightHeightM: 18,
    canyonH: 18,
    canyonW: 26,
    laneOffsetsM: [0, 0, 0, 0, 0],
    geometrySource: 'measured',
    ...overrides,
  };
}
/** An open street: no walls, so the λ < 0.1 path and street wind = 0.6 × ambient. */
const open = (overrides: Partial<RawSegment> = {}) =>
  seg({ canyonH: 0, leftHeightM: 0, rightHeightM: 0, ...overrides });
const wind: Wind = { speedMs: 5, directionDeg: 210 }; // blows toward 30°

/** Zoom 18.5-ish: 34 px is 3.4 m, so k = 2 — every other lattice point, 6 m. */
const CLOSE = { mpp: 0.1 };
/** Zoom ~16: 34 px is 13.6 m, k = 5 — every fifth point, 15 m. */
const MID = { mpp: 0.4 };
/** Zoom ~13.5: 34 px is 129 m, k = 43. */
const FAR = { mpp: 3.8 };

const K_LON = Math.cos(55.6761 * Math.PI / 180);
function centreM(a: ReturnType<typeof buildFlowField>[number]) {
  const along = offsetAlongBearing({ lon: a.lon, lat: a.lat }, a.bearingDeg, a.baseAlongM);
  const c = a.baseCrossM === 0 ? along : offsetAlongBearing(along, a.bearingDeg + 90, a.baseCrossM);
  return { x: c.lon * 111320 * K_LON, y: c.lat * 111320 };
}
/** Smallest distance between any two arrow centres, metres. */
function minCentreDist(field: ReturnType<typeof buildFlowField>): number {
  const pts = field.map(centreM);
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}

describe('roadWidthM', () => {
  it('class width, or half the canyon when wider, never more than the canyon; cycleways keep their own', () => {
    expect(roadWidthM(3, 20)).toBe(10); // residential in a 20 m canyon: half the canyon beats 7
    expect(roadWidthM(3, 12)).toBe(7); //  residential in a 12 m canyon: the class width
    expect(roadWidthM(3, 5)).toBe(5); //   never wider than the canyon
    expect(roadWidthM(0, 60)).toBe(30); // primary in a 60 m canyon
    expect(roadWidthM(4, 40)).toBe(3.5); // cycleway
  });
});

describe('buildFlowField — the lattice', () => {
  it('rows across the road: a 30 m carriageway zoomed in carries offsets every 6 m out to ±12 m', () => {
    const pri = seg({ classRank: 0, bearingDeg: 90, segmentLengthM: 6, widthM: 60, leftDistM: 30, rightDistM: 30, canyonW: 60 });
    const cross = [...new Set(buildFlowField([pri], wind, CLOSE).map((a) => a.baseCrossM))].sort((p, q) => p - q);
    expect(cross).toEqual([-12, -6, 0, 6, 12]); // 15 − 1.5 margin = 13.5 → |j·3| ≤ 13.5, even j only (k = 2)
  });

  it('a residential street in a 20 m canyon: one row zoomed in beyond 6 m, three rows at 3 m', () => {
    const res = seg({ bearingDeg: 90, segmentLengthM: 6, widthM: 20, leftDistM: 10, rightDistM: 10, canyonW: 20 });
    expect([...new Set(buildFlowField([res], wind, CLOSE).map((a) => a.baseCrossM))].sort((p, q) => p - q)).toEqual([0]);
    expect([...new Set(buildFlowField([res], wind, { mpp: 0.05 }).map((a) => a.baseCrossM))].sort((p, q) => p - q)).toEqual([-3, 0, 3]);
  });

  it('a cycleway is one row at every zoom', () => {
    const cyc = seg({ classRank: 4, bearingDeg: 90, segmentLengthM: 60, widthM: 40, leftDistM: 20, rightDistM: 20, canyonW: 40 });
    for (const o of [{ mpp: 0.05 }, CLOSE, MID]) expect(buildFlowField([cyc], wind, o).every((a) => a.baseCrossM === 0)).toBe(true);
  });

  it('columns along the road sit on the 3 m grid from the way start, every k-th', () => {
    // 60 m piece at CLOSE (k = 2): i = 0, 2, …, 20 → −30, −24, …, 30 from the midpoint.
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 60, widthM: 12, leftDistM: 6, rightDistM: 6, canyonW: 12 })], wind, CLOSE);
    expect([...new Set(field.map((a) => a.baseAlongM))].sort((p, q) => p - q)).toEqual([-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30]);
  });

  it('positions come from the way, not the piece: a piece starting at 40 m carries i = 14, 16, 18, 20', () => {
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 20, startM: 40, widthM: 12, leftDistM: 6, rightDistM: 6, canyonW: 12 })], wind, CLOSE);
    expect([...new Set(field.map((a) => a.baseAlongM))].sort((p, q) => p - q)).toEqual([-8, -2, 4, 10]);
  });

  it('zooming out thins the lattice but every arrow still sits on a 3 m lattice point of its road', () => {
    // The drawn subset changes with zoom (k = 2, 5, 43); the points it is drawn from do not.
    const piece = seg({ bearingDeg: 90, segmentLengthM: 300, widthM: 60, leftDistM: 30, rightDistM: 30, canyonW: 60, classRank: 0 });
    for (const o of [CLOSE, MID, FAR]) {
      const f = buildFlowField([piece], wind, o);
      expect(f.length).toBeGreaterThan(0);
      for (const a of f) {
        const fromStart = a.baseAlongM + 150; // startM 0, midpoint at 150 m
        expect(Math.abs(fromStart / 3 - Math.round(fromStart / 3))).toBeLessThan(1e-9);
        expect(Math.abs(a.baseCrossM / 3 - Math.round(a.baseCrossM / 3))).toBeLessThan(1e-9);
      }
    }
    // At MID the pitch is 13.6 m, so k = 5 → columns 15 m apart and the rows collapse to the centreline (15 > 13.5).
    const mid = buildFlowField([piece], wind, MID).sort((a, b) => a.baseAlongM - b.baseAlongM);
    expect(new Set(mid.map((a) => a.baseCrossM))).toEqual(new Set([0]));
    for (let i = 1; i < mid.length; i++) expect(mid[i].baseAlongM - mid[i - 1].baseAlongM).toBeCloseTo(15, 9);
  });

  it('a 6 m stub still gets its arrow', () => {
    expect(buildFlowField([seg({ segmentLengthM: 6 })], wind, MID).length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildFlowField — one arrow per screen cell, decided by rank', () => {
  it('a cycleway 4 m from its road adds nothing where the road\'s lattice already is, and the road keeps all of its own', () => {
    const road = seg({ wayId: 10, classRank: 3, bearingDeg: 90, segmentLengthM: 300, widthM: 20, leftDistM: 10, rightDistM: 10, canyonW: 20 });
    const beside = offsetAlongBearing({ lon: road.lon, lat: road.lat }, 0, 4);
    const cycle = seg({ wayId: 11, classRank: 4, bearingDeg: 90, segmentLengthM: 300, lon: beside.lon, lat: beside.lat });
    for (const o of [CLOSE, MID]) {
      const alone = buildFlowField([road], wind, o).map((a) => `${a.baseAlongM}:${a.baseCrossM}`).sort();
      const both = buildFlowField([cycle, road], wind, o);
      expect(both.filter((a) => a.wayId === 10).map((a) => `${a.baseAlongM}:${a.baseCrossM}`).sort()).toEqual(alone);
      expect(minCentreDist(both)).toBeGreaterThanOrEqual(0.75 * 34 * o.mpp - 1e-9);
    }
  });

  it('is deterministic: input order does not change the result', () => {
    const a = seg({ wayId: 5, bearingDeg: 30, segmentLengthM: 60 });
    const b = seg({ wayId: 6, bearingDeg: 120, segmentLengthM: 60 });
    const key = (f: ReturnType<typeof buildFlowField>) => f.map((x) => `${x.wayId}:${x.baseAlongM}:${x.baseCrossM}`).sort().join('|');
    expect(key(buildFlowField([a, b], wind, MID))).toBe(key(buildFlowField([b, a], wind, MID)));
  });

  it('no two arrows closer than 0.75 of a pitch, on a tight grid of crossing streets, at four zooms', () => {
    const grid = [
      ...Array.from({ length: 8 }, (_, i) => seg({ wayId: 100 + i, bearingDeg: 90, segmentLengthM: 200, lat: 55.6761 + i * 25 / 111320 })),
      ...Array.from({ length: 8 }, (_, i) => seg({ wayId: 200 + i, bearingDeg: 0, segmentLengthM: 200, lon: 12.5683 + i * 25 / (111320 * K_LON) })),
    ];
    for (const m of [0.05, 0.1, 0.4, 3.8]) {
      const f = buildFlowField(grid, wind, { mpp: m });
      expect(f.length).toBeGreaterThan(0);
      expect(minCentreDist(f)).toBeGreaterThanOrEqual(0.75 * 34 * m - 1e-9);
    }
  });

  it('the count is bounded by the cells in view, not the streets', () => {
    const many = Array.from({ length: 500 }, (_, i) => seg({ wayId: i, segmentLengthM: 5, lon: 12.5683 + (i % 20) * 1e-6, lat: 55.6761 + Math.floor(i / 20) * 1e-6 }));
    expect(buildFlowField(many, wind, MID)).toHaveLength(1);
  });

  it('empty input or a non-positive scale yields nothing', () => {
    expect(buildFlowField([], wind, MID)).toEqual([]);
    expect(buildFlowField([seg()], wind, { mpp: 0 })).toEqual([]);
  });
});

describe('buildFlowField — the glyph', () => {
  it('every arrow is 22 px, 24 on a phone, whatever the wind or zoom', () => {
    const sizes = new Set<number>();
    for (const w of [{ speedMs: 1, directionDeg: 0 }, { speedMs: 20, directionDeg: 0 }]) for (const o of [CLOSE, MID, FAR]) for (const a of buildFlowField([open()], w, o)) sizes.add(a.sizePx);
    expect(sizes).toEqual(new Set([22]));
    expect(buildFlowField([open()], wind, { ...CLOSE, isMobile: true })[0].sizePx).toBe(24);
  });

  it('opacity carries absolute strength: 0.55 + 0.45·min(v / 5, 1)', () => {
    const at = (ambient: number) => buildFlowField([open()], { speedMs: ambient, directionDeg: 0 }, CLOSE)[0].alpha;
    expect(at(0)).toBeCloseTo(0.55, 9);
    expect(at(5)).toBeCloseTo(0.55 + 0.45 * 0.6, 9); // open street: 3.0 m/s
    expect(at(40)).toBeCloseTo(1, 9);
  });
});

describe('buildFlowField — brightness wave', () => {
  it('phase advances downwind and stays in [0, 1)', () => {
    // Wind toward 45° on a north–south road, one row: consecutive arrows 6 m apart along
    // the road advance 6·cos 45° = 4.2 m along the wind, a quarter of the 20.4 m wavelength.
    const road = seg({ bearingDeg: 0, segmentLengthM: 120, widthM: 12, leftDistM: 6, rightDistM: 6, canyonW: 12 });
    const field = buildFlowField([road], { speedMs: 5, directionDeg: 225 }, CLOSE).sort((a, b) => a.baseAlongM - b.baseAlongM);
    for (const a of field) { expect(a.phase).toBeGreaterThanOrEqual(0); expect(a.phase).toBeLessThan(1); }
    const d = (field[1].phase - field[0].phase + 1) % 1;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.5);
  });
});

describe('buildFlowField — direction', () => {
  it('arrows point in the true wind vector, not the street axis', () => {
    // Ported from buildWindArrows.test.ts. Street at bearing 30, wind from 120 blows
    // toward 300: perpendicular. An open street has no canyon to rotate the flow.
    const crossWind: Wind = { speedMs: 8, directionDeg: 120 };
    const [arrow] = buildFlowField([open({ bearingDeg: 30 })], crossWind, MID);
    const flow = arrow.flowDeg;
    const deltaFromAxis = Math.min(Math.abs(((flow - 30 + 540) % 360) - 180), Math.abs(((flow - 210 + 540) % 360) - 180));
    expect(deltaFromAxis).toBeGreaterThan(30);
  });
});
