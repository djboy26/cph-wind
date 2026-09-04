// src/layers/FlowLineLayer.test.ts
// The arrow field the app actually renders. Pins the zoom density rule (step 5b)
// and carries the one property worth keeping from the deleted buildWindArrows
// tests: arrows point in the true wind vector, not along the street.
import { describe, it, expect } from 'vitest';
import { buildFlowField } from './FlowLineLayer';
import type { RawSegment } from './buildWindArrows';
import type { Wind } from '../math';

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

describe('buildFlowField — density', () => {
  const wind: Wind = { speedMs: 5, directionDeg: 210 }; // blows toward 30°, along the street

  it('at one arrow per street the field is static', () => {
    const field = buildFlowField([seg(), seg({ bearingDeg: 120 })], wind, 1);
    expect(field).toHaveLength(2);
    for (const a of field) {
      expect(a.travelLenM).toBe(0);
      expect(a.baseAlongM).toBe(0); // centred on the segment
      expect(a.phase).toBe(0);
    }
  });

  it('at three arrows per street they stagger at 0, ⅓, ⅔ and drift', () => {
    const field = buildFlowField([seg()], wind, 3);
    expect(field).toHaveLength(3);
    expect(field.map((a) => a.phase)).toEqual([0, 1 / 3, 2 / 3]);
    for (const a of field) expect(a.travelLenM).toBeGreaterThan(0);
  });

  it('defaults to three per street', () => {
    expect(buildFlowField([seg()], wind)).toHaveLength(3);
  });
});

describe('buildFlowField — direction', () => {
  it('arrows point in the true wind vector, not the street axis', () => {
    // Ported from buildWindArrows.test.ts. Street at bearing 30, wind from 120 blows
    // toward 300: perpendicular. An open street has no canyon to rotate the flow, so
    // the arrow must sit far from both directions of the street axis.
    const crossWind: Wind = { speedMs: 8, directionDeg: 120 };
    const [arrow] = buildFlowField([open({ bearingDeg: 30 })], crossWind, 1);
    const flow = arrow.flowDeg;
    const deltaFromAxis = Math.min(
      Math.abs(((flow - 30 + 540) % 360) - 180),
      Math.abs(((flow - 210 + 540) % 360) - 180),
    );
    expect(deltaFromAxis).toBeGreaterThan(30);
  });
});

describe('buildFlowField — size', () => {
  it('sizes in pixels on 8 + 2.2·v, clamped to 8..22', () => {
    // Open street: street wind is exactly 0.6 × ambient whatever the direction.
    const at = (ambient: number) => buildFlowField([open()], { speedMs: ambient, directionDeg: 0 }, 1)[0].sizePx;
    expect(at(0)).toBe(8); //                    floor
    expect(at(10)).toBeCloseTo(8 + 6.0 * 2.2, 9); // 6.0 m/s on the street → 21.2 px
    expect(at(40)).toBe(22); //                   ceiling
  });
});
