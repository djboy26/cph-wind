import { describe, expect, it } from 'vitest';
import { contrast, oklabL, oklchToRgb, ramp } from './oklch';

describe('oklchToRgb', () => {
  it('maps the ends of the lightness axis to black and white', () => {
    expect(oklchToRgb(0, 0, 0)).toEqual([0, 0, 0]);
    expect(oklchToRgb(1, 0, 0)).toEqual([255, 255, 255]);
  });

  it("reproduces sRGB red from its published OKLCH (Ottosson's matrices)", () => {
    // #ff0000 = oklch(0.62796 0.25768 29.234)
    const [r, g, b] = oklchToRgb(0.62796, 0.25768, 29.234);
    expect(r).toBeGreaterThanOrEqual(254);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('round-trips lightness: oklabL(oklchToRgb(L, C, h)) ≈ L inside the gamut', () => {
    for (const [L, C, h] of [[0.5, 0.05, 200], [0.7, 0.1, 30], [0.85, 0.06, 90], [0.35, 0.08, 270]] as const) {
      expect(oklabL(oklchToRgb(L, C, h))).toBeCloseTo(L, 2);
    }
  });

  it('keeps lightness when it has to cut chroma to reach the gamut', () => {
    const rgb = oklchToRgb(0.9, 0.4, 260); // far outside sRGB
    expect(oklabL(rgb)).toBeCloseTo(0.9, 2);
  });
});

describe('ramp and contrast', () => {
  it('steps lightness evenly', () => {
    const Ls = ramp(6, [0.8, 0.08, 200], [0.4, 0.15, 30]).map(oklabL);
    const steps = Ls.slice(1).map((L, i) => Ls[i] - L);
    for (const s of steps) expect(s).toBeCloseTo(0.08, 2);
  });

  it('gives the WCAG ratios of the reference pairs', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2); // #767676, the classic 4.5:1 grey
  });
});
