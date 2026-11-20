import { describe, expect, it } from 'vitest';
import { WebMercatorViewport } from '@deck.gl/core';
import { boxForBounds, boxKey, snapDegFor, PAD, SNAP_DEG, MAX_SPAN_DEG, MAX_CELL_DEG } from './viewBox';

const HCA = { lon: 12.5687, lat: 55.6754 };
const bounds = (lon: number, lat: number, zoom: number, w = 1440, h = 900, pitch = 0) =>
  new WebMercatorViewport({ width: w, height: h, longitude: lon, latitude: lat, zoom, pitch }).getBounds() as [number, number, number, number];

describe('snapDegFor', () => {
  it('is a power-of-two multiple of SNAP_DEG near a quarter of the view, from SNAP_DEG to MAX_CELL_DEG', () => {
    for (const span of [0.001, 0.005, 0.02, 0.05, 0.0874, 0.12]) {
      const c = snapDegFor(span);
      expect(Number.isInteger(Math.log2(c / SNAP_DEG))).toBe(true);
      expect(c).toBeGreaterThanOrEqual(SNAP_DEG);
      expect(c).toBeLessThanOrEqual(MAX_CELL_DEG);
      if (c > SNAP_DEG && c < MAX_CELL_DEG) {
        expect(c / (span * 0.25)).toBeGreaterThan(Math.SQRT1_2 - 1e-9);
        expect(c / (span * 0.25)).toBeLessThan(Math.SQRT2 + 1e-9);
      }
    }
  });
});

describe('boxForBounds', () => {
  const views = [
    { name: 'desktop city', zoom: 13.5, w: 1440, h: 900 },
    { name: 'phone city', zoom: 13, w: 390, h: 844 },
    { name: 'desktop 16.5', zoom: 16.5, w: 1440, h: 900 },
    { name: 'desktop 18.5', zoom: 18.5, w: 1440, h: 900 },
  ];

  it('keeps the view inside with at least PAD of it to spare, while it fits under MAX_SPAN_DEG', () => {
    for (const v of views) {
      for (let k = 0; k < 40; k++) {
        const b = bounds(HCA.lon + k * 0.0013, HCA.lat + k * 0.0007, v.zoom, v.w, v.h);
        const [w, s, e, n] = boxForBounds(b);
        const sx = b[2] - b[0], sy = b[3] - b[1];
        if (sx * (1 + 2 * PAD) + snapDegFor(sx) <= MAX_SPAN_DEG) {
          expect(b[0] - w).toBeGreaterThanOrEqual(PAD * sx - 1e-9);
          expect(e - b[2]).toBeGreaterThanOrEqual(PAD * sx - 1e-9);
        }
        if (sy * (1 + 2 * PAD) + snapDegFor(sy) <= MAX_SPAN_DEG) {
          expect(b[1] - s).toBeGreaterThanOrEqual(PAD * sy - 1e-9);
          expect(n - b[3]).toBeGreaterThanOrEqual(PAD * sy - 1e-9);
        }
      }
    }
  });

  it('is about 1.5 views across at the city view, as the box was before sprint 2', () => {
    const b = bounds(HCA.lon, HCA.lat, 13.5);
    const [w, s, e, n] = boxForBounds(b);
    expect((e - w)).toBeLessThanOrEqual(MAX_SPAN_DEG + snapDegFor(MAX_SPAN_DEG) + 1e-9);
    expect((n - s) / (b[3] - b[1])).toBeGreaterThan(1.4);
    expect((n - s) / (b[3] - b[1])).toBeLessThan(1.8);
  });

  it('always holds the MAX_SPAN_DEG window centred on a view wider than that (a pitched city view)', () => {
    for (let k = 0; k < 60; k++) {
      const b = bounds(HCA.lon + k * 0.0011, HCA.lat + k * 0.0003, 13.5, 1440, 900, 40);
      expect(b[2] - b[0]).toBeGreaterThan(MAX_SPAN_DEG); // the case under test
      const [w, , e] = boxForBounds(b);
      const c = (b[0] + b[2]) / 2;
      expect(w).toBeLessThanOrEqual(c - MAX_SPAN_DEG / 2 + 1e-9);
      expect(e).toBeGreaterThanOrEqual(c + MAX_SPAN_DEG / 2 - 1e-9);
    }
  });

  it('changes about every quarter screen of pan: at most 6 boxes over one screen width, at every zoom', () => {
    for (const v of views) {
      const b0 = bounds(HCA.lon, HCA.lat, v.zoom, v.w, v.h);
      const spanX = b0[2] - b0[0];
      const keys = new Set<string>();
      for (let px = 0; px <= v.w; px += 4) {
        const dx = (px / v.w) * spanX;
        keys.add(boxKey(boxForBounds(bounds(HCA.lon + dx, HCA.lat, v.zoom, v.w, v.h))));
      }
      expect(keys.size, v.name).toBeLessThanOrEqual(6);
    }
  });

  it('gives a view the same box whatever came before', () => {
    const b = bounds(HCA.lon, HCA.lat, 17.5);
    expect(boxKey(boxForBounds(b))).toBe(boxKey(boxForBounds([...b] as [number, number, number, number])));
  });
});
