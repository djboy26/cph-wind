// src/layers/FlowLineLayer.test.ts
// The arrow lattice the app renders (step 5c). One arrow per cell, lattice or on-road
// placement by zoom, pixel sizes, and the one property kept from the deleted
// buildWindArrows tests: arrows point in the true wind vector, not along the street.
import { describe, it, expect } from 'vitest';
import { buildFlowField } from './FlowLineLayer';
import type { RawSegment } from './buildWindArrows';
import { offsetAlongBearing, type Wind } from '../math';

function seg(overrides: Partial<RawSegment> = {}): RawSegment {
  return {
    wayId: 1,
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

/** Straight-line distance in metres between two arrows (equirectangular, fine at 100 m). */
function distM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const k = Math.cos(a.lat * Math.PI / 180);
  const dx = (b.lon - a.lon) * 111320 * k;
  const dy = (b.lat - a.lat) * 111320;
  return Math.hypot(dx, dy);
}

describe('buildFlowField — one arrow per cell', () => {
  it('on the lattice, a long street yields one arrow per cell it crosses, spaced one pitch apart', () => {
    // 200 m of street at bearing 90 (due east) with a 40 m pitch: 5 cells crossed.
    // 5 cells if the street starts on a cell edge, 6 otherwise — never 15 (one per 40 m
    // candidate) and never 1.
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 200 })], wind, { spacingM: 40, onRoad: false });
    expect(field.length).toBeGreaterThanOrEqual(5);
    expect(field.length).toBeLessThanOrEqual(6);
    const xs = field.map((a) => a.lon).sort((p, q) => p - q);
    for (let i = 1; i < xs.length; i++) {
      expect(distM({ lon: xs[i - 1], lat: field[0].lat }, { lon: xs[i], lat: field[0].lat })).toBeCloseTo(40, 0);
    }
    for (const a of field) expect(a.baseAlongM).toBe(0);
  });

  it('two parallel streets closer than a pitch share cells and draw once', () => {
    const road = seg({ bearingDeg: 90, segmentLengthM: 200 });
    const cycleway = offsetAlongBearing({ lon: road.lon, lat: road.lat }, 0, 8); // 8 m north
    const both = [road, seg({ bearingDeg: 90, segmentLengthM: 200, lon: cycleway.lon, lat: cycleway.lat, wayId: 2 })];
    const alone = buildFlowField([road], wind, { spacingM: 40, onRoad: false }).length;
    expect(buildFlowField(both, wind, { spacingM: 40, onRoad: false })).toHaveLength(alone);
  });

  it('a street shorter than half a pitch still gets its one arrow', () => {
    expect(buildFlowField([seg({ segmentLengthM: 8 })], wind, { spacingM: 40, onRoad: false })).toHaveLength(1);
  });

  it('on the road, arrows sit on the segment rather than on the cell centre', () => {
    const s = seg({ bearingDeg: 90, segmentLengthM: 200 });
    const field = buildFlowField([s], wind, { spacingM: 40, onRoad: true });
    expect(field.length).toBeGreaterThanOrEqual(5);
    expect(field.length).toBeLessThanOrEqual(6);
    for (const a of field) {
      expect(a.lon).toBe(s.lon);
      expect(a.lat).toBe(s.lat);
      expect(Math.abs(a.baseAlongM)).toBeLessThanOrEqual(100);
    }
  });

  it('the count is bounded by the cells in view, not the streets', () => {
    // 500 short segments dropped inside one 40 m cell collapse to a single arrow.
    const many = Array.from({ length: 500 }, (_, i) => seg({ wayId: i, segmentLengthM: 5, lon: 12.5683 + (i % 20) * 1e-6, lat: 55.6761 + Math.floor(i / 20) * 1e-6 }));
    expect(buildFlowField(many, wind, { spacingM: 40, onRoad: false })).toHaveLength(1);
  });

  it('empty input or a non-positive pitch yields nothing', () => {
    expect(buildFlowField([], wind, { spacingM: 40, onRoad: false })).toEqual([]);
    expect(buildFlowField([seg()], wind, { spacingM: 0, onRoad: false })).toEqual([]);
  });
});

describe('buildFlowField — brightness wave', () => {
  it('phase advances by one wavelength every WAVELENGTH_CELLS (6) cells downwind', () => {
    // Wind from 270 blows toward 90 (east); a 480 m street due east crosses 12 cells.
    const east: Wind = { speedMs: 5, directionDeg: 270 };
    const field = buildFlowField([seg({ bearingDeg: 90, segmentLengthM: 480 })], east, { spacingM: 40, onRoad: false })
      .sort((a, b) => a.lon - b.lon);
    expect(field.length).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < field.length; i++) expect(field[i].phase).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < field.length; i++) expect(field[i].phase).toBeLessThan(1);
    // Six cells apart → same phase (one full wavelength).
    expect(field[6].phase).toBeCloseTo(field[0].phase, 9);
    // One cell apart → 1/6 apart, modulo 1.
    const d = (field[1].phase - field[0].phase + 1) % 1;
    expect(d).toBeCloseTo(1 / 6, 9);
  });
});

describe('buildFlowField — direction', () => {
  it('arrows point in the true wind vector, not the street axis', () => {
    // Ported from buildWindArrows.test.ts. Street at bearing 30, wind from 120 blows
    // toward 300: perpendicular. An open street has no canyon to rotate the flow, so
    // the arrow must sit far from both directions of the street axis.
    const crossWind: Wind = { speedMs: 8, directionDeg: 120 };
    const [arrow] = buildFlowField([open({ bearingDeg: 30 })], crossWind, { spacingM: 40, onRoad: false });
    const flow = arrow.flowDeg;
    const deltaFromAxis = Math.min(
      Math.abs(((flow - 30 + 540) % 360) - 180),
      Math.abs(((flow - 210 + 540) % 360) - 180),
    );
    expect(deltaFromAxis).toBeGreaterThan(30);
  });
});

describe('buildFlowField — size', () => {
  it('sizes in pixels on 10 + 1.6·v, clamped to 10..18', () => {
    // Open street: street wind is exactly 0.6 × ambient whatever the direction.
    const at = (ambient: number) =>
      buildFlowField([open()], { speedMs: ambient, directionDeg: 0 }, { spacingM: 40, onRoad: false })[0].sizePx;
    expect(at(0)).toBe(10); //                     floor
    expect(at(5)).toBeCloseTo(10 + 3.0 * 1.6, 9); // 3.0 m/s on the street → 14.8 px
    expect(at(40)).toBe(18); //                    ceiling
  });
});
