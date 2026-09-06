// src/layers/FlowLineLayer.test.ts
// The arrow lattice the app renders (step 5g): columns along and rows across every
// road at a whole-metre pitch in the road's own frame, a road's own lattice never
// thinned, contention only between roads, one glyph length, opacity by strength, and
// the one property kept from the deleted buildWindArrows tests: arrows point in the
// true wind vector, not along the street.
import { describe, it, expect } from 'vitest';
import { buildFlowField, pitchM, roadWidthM, rowOffsetsM } from './FlowLineLayer';
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

/** Zoom 18.5: 26 px is 4.4 m, so the pitch is 5 m. */
const CLOSE = { mpp: 0.17 };
/** Zoom 17.5: 26 px is 8.8 m, pitch 9 m. */
const STREET = { mpp: 0.34 };
/** Zoom 16.5: 26 px is 17.7 m, pitch 18 m. */
const MID = { mpp: 0.68 };
/** Zoom 13.5: 26 px is 140 m, pitch 141 m. */
const FAR = { mpp: 5.4 };

const K_LON = Math.cos(55.6761 * Math.PI / 180);
type Field = ReturnType<typeof buildFlowField>;
function centreM(a: Field[number]) {
  const along = offsetAlongBearing({ lon: a.lon, lat: a.lat }, a.bearingDeg, a.baseAlongM);
  const c = a.baseCrossM === 0 ? along : offsetAlongBearing(along, a.bearingDeg + 90, a.baseCrossM);
  return { x: c.lon * 111320 * K_LON, y: c.lat * 111320 };
}
/** Smallest distance between any two arrow centres, metres. */
function minCentreDist(field: Field): number {
  const pts = field.map(centreM);
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
}
/** The way-frame coordinates of every arrow: metres along the way from its start, and across. */
function latticeCoords(field: Field, startM: number, L: number) {
  return field.map((a) => ({ along: a.baseAlongM + startM + L / 2, across: a.baseCrossM }));
}
const uniq = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

describe('pitchM', () => {
  it('is whole metres and never under PITCH_PX on screen', () => {
    for (const mpp of [0.17, 0.34, 0.68, 1.35, 2.7, 5.4]) {
      const p = pitchM(mpp);
      expect(Number.isInteger(p)).toBe(true);
      expect(p / mpp).toBeGreaterThanOrEqual(26);
      expect(p / mpp).toBeLessThan(26 + 1 / mpp + 1e-9); // within one metre of the target
    }
    expect(pitchM(0.17)).toBe(5);
    expect(pitchM(0.34)).toBe(9);
    expect(pitchM(0.68)).toBe(18);
    expect(pitchM(5.4)).toBe(141);
  });
  it('phones get two more pixels of pitch', () => {
    expect(pitchM(0.34, true)).toBe(10);
  });
});

describe('roadWidthM', () => {
  it('is the class width, never more than the canyon', () => {
    expect(roadWidthM(0, 40)).toBe(16);
    expect(roadWidthM(0, 12)).toBe(12);
    expect(roadWidthM(3, 20)).toBe(7);
    expect(roadWidthM(3, 5)).toBe(5);
    expect(roadWidthM(4, 30)).toBe(3.5);
    expect(roadWidthM(5, 0)).toBe(5); // no canyon measured: the class width
  });
});

describe('rowOffsetsM', () => {
  it('fills the half-width with rows a pitch apart, centred, whole metres', () => {
    expect(rowOffsetsM(6.5, 5)).toEqual([-5, 0, 5]); // an arterial at zoom 18.5
    expect(rowOffsetsM(6.5, 9)).toEqual([-5, 5]); // the same at 17.5: two rows, ±4.5 rounded out
    expect(rowOffsetsM(6.5, 18)).toEqual([0]); // and at 16.5: the centreline
    expect(rowOffsetsM(2, 5)).toEqual([0]); // a residential street: one row until the pitch is 4 m
    expect(rowOffsetsM(2, 4)).toEqual([-2, 2]);
    expect(rowOffsetsM(9.75, 5)).toEqual([-8, -3, 3, 8]);
  });
  it('rows are never closer than a pitch less the rounding, and always inside the half-width plus it', () => {
    for (const halfW of [0, 1, 2, 3.5, 5, 6.5, 9.75]) for (const p of [4, 5, 7, 9, 18, 141]) {
      const rows = rowOffsetsM(halfW, p);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(p - 1);
      for (const r of rows) expect(Math.abs(r)).toBeLessThanOrEqual(halfW + 0.5);
      expect(rows).toEqual(rows.map((r) => (r === 0 ? 0 : -r)).reverse()); // symmetric
    }
  });
});

describe('buildFlowField — the lattice', () => {
  it('a straight arterial alone is a complete grid: every column × every row, nothing thinned', () => {
    // 60 m piece at 5 m pitch: columns at 0, 5, …, 60 (13); rows −5, 0, 5 → 39 arrows.
    const field = buildFlowField([open({ classRank: 0, canyonW: 40 })], wind, CLOSE);
    const c = latticeCoords(field, 0, 60);
    expect(uniq(c.map((q) => q.across))).toEqual([-5, 0, 5]);
    expect(uniq(c.map((q) => q.along))).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(field).toHaveLength(39);
  });

  it('at street zoom the arterial carries two rows and a residential street one', () => {
    const arterial = buildFlowField([open({ classRank: 0, canyonW: 40 })], wind, STREET);
    expect(uniq(latticeCoords(arterial, 0, 60).map((q) => q.across))).toEqual([-5, 5]);
    const residential = buildFlowField([open({ classRank: 3, canyonW: 20 })], wind, STREET);
    expect(uniq(latticeCoords(residential, 0, 60).map((q) => q.across))).toEqual([0]);
  });

  it('a cycleway is one row at every zoom', () => {
    for (const z of [CLOSE, STREET, MID, FAR]) {
      const field = buildFlowField([open({ classRank: 4, canyonW: 30 })], wind, z);
      expect(uniq(latticeCoords(field, 0, 60).map((q) => q.across))).toEqual([0]);
    }
  });

  it('columns sit on multiples of the pitch measured from the way start, not the piece', () => {
    // A piece from 40 m to 100 m at 9 m pitch carries the way marks 45, 54, …, 99.
    const field = buildFlowField([open({ startM: 40 })], wind, STREET);
    expect(uniq(latticeCoords(field, 40, 60).map((q) => q.along))).toEqual([45, 54, 63, 72, 81, 90, 99]);
  });

  it('every arrow is on a whole-metre mark of its road at every zoom', () => {
    for (const z of [CLOSE, STREET, MID]) {
      const p = pitchM(z.mpp);
      const field = buildFlowField([open({ startM: 40, classRank: 0, canyonW: 40 })], wind, z);
      expect(field.length).toBeGreaterThan(0);
      for (const q of latticeCoords(field, 40, 60)) {
        expect(q.along % p).toBeCloseTo(0, 6);
        expect(Number.isInteger(q.across)).toBe(true);
      }
    }
  });

  it('two consecutive pieces of one way share their boundary column once', () => {
    const a = open({ startM: 0, segmentLengthM: 60 });
    const b = open({ startM: 60, segmentLengthM: 60, ...offsetPiece(60) });
    const field = buildFlowField([a, b], wind, CLOSE);
    // 0..120 at 5 m: 25 columns, one row (residential in a 26 m canyon → 7 m road → halfW 2).
    expect(field).toHaveLength(25);
    expect(minCentreDist(field)).toBeGreaterThan(4.9);
  });

  it('a 6 m stub still gets its arrow', () => {
    const field = buildFlowField([open({ segmentLengthM: 6 })], wind, MID);
    expect(field.length).toBeGreaterThanOrEqual(1);
  });
});

/** Place a later piece of the same way where it belongs: 30-ish m down the bearing per its startM. */
function offsetPiece(alongM: number) {
  const base = seg();
  const mid = offsetAlongBearing({ lon: base.lon, lat: base.lat }, base.bearingDeg, alongM);
  return { lon: mid.lon, lat: mid.lat };
}

describe('buildFlowField — contention between roads only', () => {
  it('a cycleway 4 m from its road loses its arrows to the road, and the road keeps every one of its own', () => {
    const road = open({ wayId: 1, classRank: 0, canyonW: 40 });
    const off = offsetAlongBearing({ lon: road.lon, lat: road.lat }, road.bearingDeg + 90, 4);
    const cycle = open({ wayId: 2, classRank: 4, lon: off.lon, lat: off.lat });
    const alone = buildFlowField([road], wind, CLOSE);
    const both = buildFlowField([road, cycle], wind, CLOSE);
    expect(both.filter((a) => a.wayId === 1)).toHaveLength(alone.length);
    expect(both.filter((a) => a.wayId === 2)).toHaveLength(0);
  });

  it('a crossing street keeps its lattice except within 0.7 pitch of the arterial\'s arrows', () => {
    const arterial = open({ wayId: 1, classRank: 0, canyonW: 40, bearingDeg: 0 });
    const side = open({ wayId: 2, classRank: 3, canyonW: 20, bearingDeg: 90 });
    const sideAlone = buildFlowField([side], wind, CLOSE);
    const both = buildFlowField([arterial, side], wind, CLOSE);
    const kept = both.filter((a) => a.wayId === 2);
    expect(kept.length).toBeLessThan(sideAlone.length);
    expect(kept.length).toBeGreaterThan(sideAlone.length - 6); // a hole a few arrows wide, not a gap
    const pts = both.filter((a) => a.wayId === 1).map(centreM);
    for (const k of kept) {
      const c = centreM(k);
      for (const q of pts) expect(Math.hypot(q.x - c.x, q.y - c.y)).toBeGreaterThanOrEqual(0.7 * 5 - 1e-6);
    }
  });

  it('is deterministic: input order does not change the result', () => {
    const a = open({ wayId: 7, classRank: 1, bearingDeg: 0 });
    const b = open({ wayId: 3, classRank: 2, bearingDeg: 90 });
    const ab = buildFlowField([a, b], wind, STREET).map(centreM);
    const ba = buildFlowField([b, a], wind, STREET).map(centreM);
    expect(ab).toEqual(ba);
  });

  it('no two arrows of different roads closer than 0.7 pitch on a tight grid of crossing streets, at four zooms', () => {
    const streets: RawSegment[] = [];
    for (let i = 0; i < 4; i++) {
      const at = offsetAlongBearing({ lon: 12.5683, lat: 55.6761 }, 90, i * 12);
      streets.push(open({ wayId: 100 + i, bearingDeg: 0, lon: at.lon, lat: at.lat }));
      const at2 = offsetAlongBearing({ lon: 12.5683, lat: 55.6761 }, 0, i * 12);
      streets.push(open({ wayId: 200 + i, bearingDeg: 90, lon: at2.lon, lat: at2.lat }));
    }
    for (const z of [CLOSE, STREET, MID, FAR]) {
      const field = buildFlowField(streets, wind, z);
      const p = pitchM(z.mpp);
      const pts = field.map((a) => ({ ...centreM(a), way: a.wayId }));
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        if (pts[i].way === pts[j].way) continue;
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThanOrEqual(0.7 * p - 1e-6);
      }
    }
  });

  it('empty input or a non-positive scale yields nothing', () => {
    expect(buildFlowField([], wind, CLOSE)).toEqual([]);
    expect(buildFlowField([open()], wind, { mpp: 0 })).toEqual([]);
  });
});

describe('buildFlowField — the glyph', () => {
  it('every arrow is 19 px, 21 on a phone, whatever the wind or zoom', () => {
    for (const z of [CLOSE, MID, FAR]) for (const speed of [1, 5, 12]) {
      const w = { ...wind, speedMs: speed };
      for (const a of buildFlowField([open()], w, z)) expect(a.sizePx).toBe(19);
      for (const a of buildFlowField([open()], w, { ...z, isMobile: true })) expect(a.sizePx).toBe(21);
    }
  });

  it('opacity carries absolute strength: 0.55 + 0.45·min(v / 5, 1)', () => {
    const at = (speed: number) => buildFlowField([open()], { ...wind, speedMs: speed }, MID)[0].alpha;
    // open street: street wind = 0.6 × ambient
    expect(at(0)).toBeCloseTo(0.55, 6);
    expect(at(5)).toBeCloseTo(0.55 + 0.45 * 0.6, 6);
    expect(at(20)).toBeCloseTo(1, 6);
  });
});

describe('buildFlowField — brightness wave', () => {
  it('phase advances downwind and stays in [0, 1)', () => {
    // Wind toward 30° along a 30° road: arrows further along the road are further downwind.
    const field = buildFlowField([open({ classRank: 0, canyonW: 40 })], wind, STREET)
      .filter((a) => a.baseCrossM === field0Cross);
    const byAlong = [...field].sort((a, b) => a.baseAlongM - b.baseAlongM);
    for (const a of byAlong) { expect(a.phase).toBeGreaterThanOrEqual(0); expect(a.phase).toBeLessThan(1); }
    // One pitch downwind is 1 / WAVELENGTH_CELLS of a cycle.
    for (let i = 1; i < byAlong.length; i++) {
      const d = ((byAlong[i].phase - byAlong[i - 1].phase) % 1 + 1) % 1;
      expect(d).toBeCloseTo(1 / 6, 3);
    }
  });
});
const field0Cross = 5;

describe('buildFlowField — direction', () => {
  it('arrows point in the true wind vector, not the street axis', () => {
    // Street at 30°, wind from 300° (toward 120°): the open-street arrow must point
    // toward 120°, not be snapped onto the 30° axis.
    const field = buildFlowField([open()], { speedMs: 5, directionDeg: 300 }, MID);
    expect(field.length).toBeGreaterThan(0);
    for (const a of field) expect(Math.abs(a.flowDeg - 120)).toBeLessThan(0.5);
  });
});
