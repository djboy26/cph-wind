// src/layers/FlowLineLayer.test.ts
// The arrow lattice the app renders (step 5g): columns along and rows across every
// road at a whole-metre pitch in the road's own frame, a road's own lattice never
// thinned, contention only between roads, one glyph length, opacity by strength, and
// the one property kept from the deleted buildWindArrows tests: arrows point in the
// true wind vector, not along the street.
import { describe, it, expect } from 'vitest';
import {
  buildFlowField, pitchM, roadWidthM, rowOffsetsM,
  arrowColor, createFlowLineLayer, waveCycle, waveFactor, WaveIconLayer,
  WAVE_DEPTH, WAVE_GLSL, WAVE_RATE, type FlowLine,
} from './FlowLineLayer';
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

/** Zoom 18 (0.17 m/px): 24 px is 4.1 m, so the pitch is 5 m. At 18.5 it is 3 m. */
const CLOSE = { mpp: 0.17 };
/** Zoom 17 (0.34 m/px): 24 px is 8.2 m, pitch 9 m. */
const STREET = { mpp: 0.34 };
/** Zoom 16 (0.68 m/px): 24 px is 16.3 m, pitch 17 m. */
const MID = { mpp: 0.68 };
/** Zoom 13 (5.4 m/px): 24 px is 130 m, pitch 130 m. */
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
      expect(p / mpp).toBeGreaterThanOrEqual(24);
      expect(p / mpp).toBeLessThan(24 + 1 / mpp + 1e-9); // within one metre of the target
    }
    expect(pitchM(0.17)).toBe(5);
    expect(pitchM(0.34)).toBe(9);
    expect(pitchM(0.68)).toBe(17);
    expect(pitchM(5.4)).toBe(130);
  });
  it('phones get two more pixels of pitch', () => {
    expect(pitchM(0.34, true)).toBe(9);
    expect(pitchM(0.68, true)).toBe(18);
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
    expect(rowOffsetsM(6.5, 3)).toEqual([-6, -3, 0, 3, 6]); // an arterial at zoom 18.5 (3 m pitch)
    expect(rowOffsetsM(6.5, 5)).toEqual([-5, 0, 5]); // at zoom 18
    expect(rowOffsetsM(6.5, 9)).toEqual([-5, 5]); // at 17: two rows, ±4.5 rounded out
    expect(rowOffsetsM(6.5, 17)).toEqual([0]); // and at 16: the centreline
    expect(rowOffsetsM(2, 5)).toEqual([0]); // a residential street: one row until the pitch is 4 m
    expect(rowOffsetsM(2, 4)).toEqual([-2, 2]);
    expect(rowOffsetsM(9.75, 5)).toEqual([-8, -3, 3, 8]);
  });
  it('rows are never closer than a pitch less the rounding, and always inside the half-width plus it', () => {
    for (const halfW of [0, 1, 2, 3.5, 5, 6.5, 9.75]) for (const p of [4, 5, 7, 9, 17, 130]) {
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
    // 60 m piece at 5 m pitch (zoom 18): columns at 0, 5, …, 60 (13); rows −5, 0, 5 → 39 arrows.
    const field = buildFlowField([open({ classRank: 0, canyonW: 40 })], wind, CLOSE);
    const c = latticeCoords(field, 0, 60);
    expect(uniq(c.map((q) => q.across))).toEqual([-5, 0, 5]);
    expect(uniq(c.map((q) => q.along))).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
    expect(field).toHaveLength(39);
  });

  it('at zoom 17 the arterial carries two rows and a residential street one', () => {
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
    // A piece from 40 m to 100 m at 9 m pitch (zoom 17) carries the way marks 45, 54, …, 99.
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
  it('every arrow is 18 px, 20 on a phone, whatever the wind or zoom', () => {
    for (const z of [CLOSE, MID, FAR]) for (const speed of [1, 5, 12]) {
      const w = { ...wind, speedMs: speed };
      for (const a of buildFlowField([open()], w, z)) expect(a.sizePx).toBe(18);
      for (const a of buildFlowField([open()], w, { ...z, isMobile: true })) expect(a.sizePx).toBe(20);
    }
  });

  it('opacity carries absolute strength: 0.75 + 0.25·min(v / 5, 1)', () => {
    const at = (speed: number) => buildFlowField([open()], { ...wind, speedMs: speed }, MID)[0].alpha;
    // open street: street wind = 0.6 × ambient
    expect(at(0)).toBeCloseTo(0.75, 6);
    expect(at(5)).toBeCloseTo(0.75 + 0.25 * 0.6, 6);
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

describe('the brightness wave runs in the shader (sprint 1)', () => {
  // The per-arrow alpha the CPU computed every frame until sprint 1 (arrowAlpha, main@04049a9).
  const cpuAlpha = (alpha: number, phase: number, t: number) =>
    alpha * (1 - 0.15 + 0.15 * Math.sin(2 * Math.PI * (phase - t * 0.25)));

  it('waveFactor is the old per-frame formula: base alpha × factor agrees over phase and time', () => {
    const worst = (tOffset: number) => {
      let w = 0;
      for (let i = 0; i <= 40; i++) for (let j = 0; j <= 100; j++) {
        const phase = i / 40, t = tOffset + j * 0.37, alpha = 0.75 + 0.025 * (i % 11);
        w = Math.max(w, Math.abs(alpha * waveFactor(phase, t) - cpuAlpha(alpha, phase, t)));
      }
      return w;
    };
    // First minute: identical to rounding.
    expect(worst(0)).toBeLessThan(1e-13);
    // A day open: the old formula's own sin argument (~1.4e5 rad) carries ~1e-11 rad of
    // rounding that waveCycle avoids, so the two differ by a few 1e-12 there, the old one
    // being the less exact.
    expect(worst(86_000)).toBeLessThan(1e-10);
  });

  it('the injected GLSL computes waveFactor (its right-hand side evaluated on the same inputs)', () => {
    expect(WAVE_GLSL.startsWith('vColor.a *= ')).toBe(true);
    const rhs = WAVE_GLSL.slice('vColor.a *= '.length, -1);
    const glsl = new Function('wave', 'instancePhases', 'sin', `return ${rhs};`) as
      (wave: { cycle: number; depth: number }, instancePhases: number, sin: (x: number) => number) => number;
    for (const phase of [0, 0.1, 0.25, 0.5, 0.9]) for (const t of [0, 0.5, 1.7, 3.99, 86_400.25]) {
      const cycle = waveCycle(t);
      expect(glsl({ cycle, depth: WAVE_DEPTH }, phase, Math.sin)).toBeCloseTo(waveFactor(phase, t), 12);
      expect(glsl({ cycle, depth: 0 }, phase, Math.sin)).toBe(1); // reduced motion: base opacity exactly
    }
  });

  it('the clock reaches the shader as one cycle, in [0, 1): a day open keeps sin() inside ±2π', () => {
    for (const t of [0, 1, 3.999, 4, 59.5, 86_400, 86_400 * 30 + 0.123]) {
      const c = waveCycle(t);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(1);
      expect(c).toBeCloseTo(((t * WAVE_RATE) % 1 + 1) % 1, 9);
    }
    expect(waveCycle(4)).toBe(0); // one 4 s period
  });

  it('the wave stays inside ±WAVE_DEPTH of the base opacity, and the floor clears the old 0.55', () => {
    for (let k = 0; k < 1000; k++) {
      const f = waveFactor(k / 1000, k * 0.013);
      expect(f).toBeGreaterThanOrEqual(1 - 2 * WAVE_DEPTH - 1e-12);
      expect(f).toBeLessThanOrEqual(1 + 1e-12);
    }
    // Calmest arrow at the wave's trough: 0.75 × 0.70 = 0.525 of full opacity, as before sprint 1.
    expect(0.75 * (1 - 2 * WAVE_DEPTH)).toBeCloseTo(0.525, 12);
  });

  it('per-arrow colour is static: shelter colour plus base opacity, no time in it', () => {
    const a = buildFlowField([open()], wind, MID)[0];
    expect(arrowColor(a)).toEqual([a.color[0], a.color[1], a.color[2], Math.round(255 * a.alpha)]);
    expect(arrowColor(a)).toEqual(arrowColor({ ...a })); // same input, same output, at any time
  });

  it('the layer carries no time-based update trigger and passes the phase and animate flag through', () => {
    const data = buildFlowField([open()], wind, MID);
    for (const animate of [true, false]) {
      const [layer] = createFlowLineLayer({ data, animate, isMobile: false });
      expect(layer).toBeInstanceOf(WaveIconLayer);
      const props = layer.props as unknown as {
        updateTriggers: Record<string, unknown>; animate: boolean;
        getPhase: (d: FlowLine) => number; getColor: (d: FlowLine) => number[];
      };
      expect(props.updateTriggers).toEqual({});
      expect(props.animate).toBe(animate);
      expect(props.getPhase(data[0])).toBe(data[0].phase);
      expect(props.getColor(data[0])).toEqual(arrowColor(data[0]));
    }
  });

  it('the shaders keep the IconLayer modules and add the wave uniforms, the phase attribute and the alpha line', () => {
    const [layer] = createFlowLineLayer({ data: [], animate: true, isMobile: false });
    // getShaders() reads the default modules from the layer context, which only exists
    // once deck.gl has mounted the layer; an empty one stands in for it here.
    (layer as unknown as { context: unknown }).context = { defaultShaderModules: [] };
    const shaders = (layer as WaveIconLayer).getShaders() as {
      modules: { name: string; uniformTypes?: Record<string, string> }[]; inject: Record<string, string>;
    };
    const names = shaders.modules.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(['project32', 'picking', 'icon', 'wave']));
    expect(shaders.modules.find((m) => m.name === 'wave')?.uniformTypes).toEqual({ cycle: 'f32', depth: 'f32' });
    expect(shaders.inject['vs:#decl']).toBe('in float instancePhases;');
    expect(shaders.inject['vs:#main-end']).toBe(WAVE_GLSL);
  });
});
