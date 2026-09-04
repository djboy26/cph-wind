// src/layers/FlowLineLayer.test.ts
// The arrow field the app renders (step 5e). Arrows at fixed world positions along
// every way, zoom-thinned to a subset, deterministic cell contention, constant length,
// opacity by strength, and the one property kept from the deleted buildWindArrows
// tests: arrows point in the true wind vector, not along the street.
import { describe, it, expect } from 'vitest';
import { buildFlowField } from './FlowLineLayer';
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

const wind: Wind = { speedMs: 5, directionDeg: 210 }; // blows toward 30°, along the default street
/** Across the default bearing-90 test roads: blows toward 0. */
const across: Wind = { speedMs: 5, directionDeg: 180 };

/** Zoom 18.5-ish: every candidate survives (k = 1, 2.8 m cells). */
const CLOSE = { mpp: 0.1 };
/** Zoom ~16: k = 4 (3 m is 7.5 px), 11.2 m cells. */
const MID = { mpp: 0.4 };

/** Local metres of an arrow's centre, tail-to-tip unit vector and half-length. */
const K_LON = Math.cos(55.6761 * Math.PI / 180); // one scale for the whole test area
function capsule(a: ReturnType<typeof buildFlowField>[number]) {
  const c = offsetAlongBearing({ lon: a.lon, lat: a.lat }, a.bearingDeg, a.baseAlongM);
  const rad = a.flowDeg * Math.PI / 180;
  return { x: c.lon * 111320 * K_LON, y: c.lat * 111320, ux: Math.sin(rad), uy: Math.cos(rad), half: a.lenM / 2 };
}
/** Pairs of arrows whose capsules overlap (24 px across, 12 px tip to tail) in either arrow's frame, at mpp. */
function overlaps(field: ReturnType<typeof buildFlowField>, mpp: number): number {
  const caps = field.map(capsule);
  const hit = (p: typeof caps[number], q: typeof caps[number]) => {
    const ex = q.x - p.x, ey = q.y - p.y;
    const along = Math.abs(ex * p.ux + ey * p.uy), perp = Math.abs(-ex * p.uy + ey * p.ux);
    return perp < 24 * mpp && along < p.half + q.half + 12 * mpp;
  };
  let n = 0;
  for (let i = 0; i < caps.length; i++) for (let j = i + 1; j < caps.length; j++) if (hit(caps[i], caps[j]) || hit(caps[j], caps[i])) n++;
  return n;
}

describe('buildFlowField — fixed positions along the way', () => {
  // The default street: 13 m carriageway (rank 3 in a 26 m canyon). Fully zoomed in that
  // is 130 px, so the along-road target is 0.4 × 130 = 52 px = 5.2 m → every 2nd 3 m
  // point → 6 m. Wind across the road so no tip-to-tail rule interferes.
  it('draws arrows on the 3 m grid from the way start, every 6 m for a 13 m carriageway zoomed in', () => {
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 60 })], across, CLOSE);
    const along = field.map((a) => a.baseAlongM).sort((p, q) => p - q);
    expect(along).toEqual([-30, -24, -18, -12, -6, 0, 6, 12, 18, 24, 30]);
  });

  it('positions come from the way, not the piece: a piece starting at 40 m carries i = 14, 16, 18, 20', () => {
    // 40 m in, 20 m long → points at 42, 48, 54, 60 m along the way = −8, −2, 4, 10 from its midpoint.
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 20, startM: 40 })], across, CLOSE);
    const along = field.map((a) => a.baseAlongM).sort((p, q) => p - q);
    expect(along).toEqual([-8, -2, 4, 10]);
  });

  it('zooming out keeps every k-th arrow, a subset of the zoomed-in set, nothing shifted', () => {
    // At 0.4 m/px the 13 m arrow is 32 px; the 28 px pitch rules: 11.2 m → every 4th point → 12 m.
    const piece = seg({ bearingDeg: 90, segmentLengthM: 60 });
    const close = new Set(buildFlowField([piece], across, CLOSE).map((a) => a.baseAlongM));
    const mid = buildFlowField([piece], across, MID).map((a) => a.baseAlongM).sort((p, q) => p - q);
    expect(mid).toEqual([-30, -18, -6, 6, 18, 30]);
    for (const m of mid) expect(close.has(m)).toBe(true);
  });

  it('a 6 m stub still gets its arrow', () => {
    expect(buildFlowField([seg({ segmentLengthM: 6 })], wind, MID).length).toBeGreaterThanOrEqual(1);
  });
});

describe('buildFlowField — one arrow per screen cell, decided by rank', () => {
  it('a cycleway 4 m from its road adds nothing that overlaps the road\'s arrows, and the road keeps all of its own', () => {
    const road = seg({ wayId: 10, classRank: 3, bearingDeg: 90, segmentLengthM: 300 });
    const beside = offsetAlongBearing({ lon: road.lon, lat: road.lat }, 0, 4);
    const cycle = seg({ wayId: 11, classRank: 4, bearingDeg: 90, segmentLengthM: 300, lon: beside.lon, lat: beside.lat });
    for (const w of [wind, across]) {
      const alone = buildFlowField([road], w, MID).map((a) => a.baseAlongM).sort((p, q) => p - q);
      const both = buildFlowField([cycle, road], w, MID);
      const roadArrows = both.filter((a) => a.wayId === 10).map((a) => a.baseAlongM).sort((p, q) => p - q);
      expect(roadArrows).toEqual(alone);
      expect(overlaps(both, MID.mpp)).toBe(0);
    }
  });

  it('is deterministic: input order does not change the result', () => {
    const a = seg({ wayId: 5, bearingDeg: 30, segmentLengthM: 60 });
    const b = seg({ wayId: 6, bearingDeg: 120, segmentLengthM: 60 });
    const key = (f: ReturnType<typeof buildFlowField>) =>
      f.map((x) => `${x.wayId}:${x.baseAlongM}`).sort().join('|');
    expect(key(buildFlowField([a, b], wind, MID))).toBe(key(buildFlowField([b, a], wind, MID)));
  });

  it('the count is bounded by the cells in view, not the streets', () => {
    // 500 short pieces dropped inside one 11 m cell collapse to one arrow.
    const many = Array.from({ length: 500 }, (_, i) => seg({ wayId: i, segmentLengthM: 5, lon: 12.5683 + (i % 20) * 1e-6, lat: 55.6761 + Math.floor(i / 20) * 1e-6 }));
    expect(buildFlowField(many, wind, MID)).toHaveLength(1);
    // A tight grid of crossing streets never draws two arrows that touch.
    const grid = [
      ...Array.from({ length: 8 }, (_, i) => seg({ wayId: 100 + i, bearingDeg: 90, segmentLengthM: 200, lat: 55.6761 + i * 25 / 111320 })),
      ...Array.from({ length: 8 }, (_, i) => seg({ wayId: 200 + i, bearingDeg: 0, segmentLengthM: 200, lon: 12.5683 + i * 25 / (111320 * Math.cos(55.6761 * Math.PI / 180)) })),
    ];
    for (const m of [0.05, 0.1, 0.4, 2]) expect(overlaps(buildFlowField(grid, wind, { mpp: m }), m)).toBe(0);
  });

  it('empty input or a non-positive scale yields nothing', () => {
    expect(buildFlowField([], wind, MID)).toEqual([]);
    expect(buildFlowField([seg()], wind, { mpp: 0 })).toEqual([]);
  });
});

describe('buildFlowField — the arrow spans the carriageway', () => {
  it('a residential street in a 20 m canyon gets 10 m arrows; a primary in a 60 m canyon 30 m', () => {
    const res = seg({ classRank: 3, widthM: 20, leftDistM: 10, rightDistM: 10, canyonW: 20 });
    const pri = seg({ classRank: 0, widthM: 60, leftDistM: 30, rightDistM: 30, canyonW: 60 });
    expect(buildFlowField([res], wind, CLOSE)[0].lenM).toBeCloseTo(10, 9);
    expect(buildFlowField([pri], wind, CLOSE)[0].lenM).toBeCloseTo(30, 9);
  });

  it('a cycleway keeps its own 3.5 m, never the canyon it runs through', () => {
    const cyc = seg({ classRank: 4, widthM: 40, leftDistM: 20, rightDistM: 20, canyonW: 40 });
    expect(buildFlowField([cyc], wind, CLOSE)[0].lenM).toBeCloseTo(3.5, 9);
  });

  it('never draws shorter than 16 px: zoomed out, a 10 m arrow becomes 16 px of metres', () => {
    const res = seg({ classRank: 3, widthM: 20, leftDistM: 10, rightDistM: 10, canyonW: 20 });
    expect(buildFlowField([res], wind, { mpp: 2 })[0].lenM).toBeCloseTo(32, 9);
  });
});

describe('buildFlowField — spacing follows the angle between wind and road', () => {
  // Open street, no canyon: the flow keeps the ambient direction.
  const alongRoad: Wind = { speedMs: 5, directionDeg: 270 }; // blows toward 90, along a bearing-90 road
  const acrossRoad: Wind = { speedMs: 5, directionDeg: 180 }; // blows toward 0, across it
  const road = () => open({ classRank: 0, bearingDeg: 90, segmentLengthM: 300, widthM: 60, leftDistM: 30, rightDistM: 30, canyonW: 60 });

  it('wind along the road: tip to tail, arrows at least length + 12 px apart', () => {
    // 30 m arrows at 0.1 m/px are 300 px; spacing ≥ 312 px = 31.2 m → i % 11 → every 33 m.
    const along = buildFlowField([road()], alongRoad, CLOSE).map((a) => a.baseAlongM).sort((p, q) => p - q);
    for (let i = 1; i < along.length; i++) expect(along[i] - along[i - 1]).toBeGreaterThanOrEqual(31.2);
  });

  it('wind across the road: parallel arrows 0.4 of a length apart', () => {
    // 300 px arrows → 120 px = 12 m target → i % 4 → every 12 m.
    const across = buildFlowField([road()], acrossRoad, CLOSE).map((a) => a.baseAlongM).sort((p, q) => p - q);
    for (let i = 1; i < across.length; i++) expect(across[i] - across[i - 1]).toBeCloseTo(12, 9);
  });

  it('positions stay on the 3 m grid whatever the spacing', () => {
    for (const w of [alongRoad, acrossRoad]) {
      for (const a of buildFlowField([road()], w, CLOSE)) {
        const fromStart = a.baseAlongM + 150; // startM 0, midpoint at 150 m
        expect(Math.abs(fromStart / 3 - Math.round(fromStart / 3))).toBeLessThan(1e-9);
      }
    }
  });
});

describe('buildFlowField — the glyph', () => {
  it('head and shaft scale with the arrow on screen, not with the wind', () => {
    // 13 m arrow at 0.1 m/px = 130 px → head 19.5 px, shaft 3.9 px; +2 / +1 on a phone.
    const calm = buildFlowField([open()], { speedMs: 1, directionDeg: 0 }, CLOSE);
    const gale = buildFlowField([open()], { speedMs: 20, directionDeg: 0 }, CLOSE);
    expect(new Set([...calm, ...gale].map((a) => a.sizePx))).toEqual(new Set([19.5]));
    expect(new Set([...calm, ...gale].map((a) => a.shaftPx))).toEqual(new Set([3.9]));
    const phone = buildFlowField([open()], wind, { ...CLOSE, isMobile: true })[0];
    expect(phone.sizePx).toBe(21.5);
    expect(phone.shaftPx).toBe(4.9);
    // Clamped: a 16 px floor arrow has a 12 px head and a 2 px shaft; a 300 px one 36 and 8.
    expect(buildFlowField([open()], wind, { mpp: 2 })[0].sizePx).toBe(12);
    expect(buildFlowField([open()], wind, { mpp: 2 })[0].shaftPx).toBe(2);
    const pri = open({ classRank: 0, widthM: 60, leftDistM: 30, rightDistM: 30, canyonW: 60 });
    expect(buildFlowField([pri], wind, CLOSE)[0].sizePx).toBe(36);
    expect(buildFlowField([pri], wind, CLOSE)[0].shaftPx).toBe(8);
  });

  it('opacity carries absolute strength: 0.55 + 0.45·min(v / 5, 1)', () => {
    // Open street: street wind is exactly 0.6 × ambient whatever the direction.
    const at = (ambient: number) => buildFlowField([open()], { speedMs: ambient, directionDeg: 0 }, CLOSE)[0].alpha;
    expect(at(0)).toBeCloseTo(0.55, 9);
    expect(at(5)).toBeCloseTo(0.55 + 0.45 * 0.6, 9); // 3.0 m/s on the street
    expect(at(40)).toBeCloseTo(1, 9);
  });
});

describe('buildFlowField — brightness wave', () => {
  it('phase advances by one wavelength every WAVELENGTH_CELLS (6) cells downwind', () => {
    // Wind toward 45° on a north–south road: arrows 6 m apart along the road advance
    // 6·cos 45° = 4.2 m along the wind, a quarter of the 16.8 m wavelength at CLOSE.
    const field = buildFlowField([seg({ bearingDeg: 0, segmentLengthM: 120 })], { speedMs: 5, directionDeg: 225 }, CLOSE)
      .sort((a, b) => a.baseAlongM - b.baseAlongM);
    for (const a of field) { expect(a.phase).toBeGreaterThanOrEqual(0); expect(a.phase).toBeLessThan(1); }
    // Phase is monotone in the wind direction (mod 1) and completes a cycle in 6 cells ≈ 16.8 m.
    const d = (field[1].phase - field[0].phase + 1) % 1;
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(0.5);
    expect(overlaps(field, CLOSE.mpp)).toBe(0);
  });
});

describe('buildFlowField — direction', () => {
  it('arrows point in the true wind vector, not the street axis', () => {
    // Ported from buildWindArrows.test.ts. Street at bearing 30, wind from 120 blows
    // toward 300: perpendicular. An open street has no canyon to rotate the flow, so
    // the arrow must sit far from both directions of the street axis.
    const crossWind: Wind = { speedMs: 8, directionDeg: 120 };
    const [arrow] = buildFlowField([open({ bearingDeg: 30 })], crossWind, MID);
    const flow = arrow.flowDeg;
    const deltaFromAxis = Math.min(
      Math.abs(((flow - 30 + 540) % 360) - 180),
      Math.abs(((flow - 210 + 540) % 360) - 180),
    );
    expect(deltaFromAxis).toBeGreaterThan(30);
  });
});
