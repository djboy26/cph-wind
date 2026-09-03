// src/cyclist/windCategory.test.ts
import { describe, it, expect } from "vitest";
import {
  WIND_BANDS,
  windBand,
  windBandColor,
  routeImpact,
  streetImpact,
} from "./windCategory";
import { canyonModifiedWind } from "../math";

describe("windBand (strength)", () => {
  it("bands are contiguous and cover 0..∞", () => {
    expect(WIND_BANDS[0].minMs).toBe(0);
    for (let i = 1; i < WIND_BANDS.length; i++) {
      expect(WIND_BANDS[i].minMs).toBe(WIND_BANDS[i - 1].maxMs);
    }
    expect(WIND_BANDS[WIND_BANDS.length - 1].maxMs).toBe(Infinity);
  });

  // Thresholds are now 1.2 / 2.4 / 3.6 / 5 / 7, rider-height metres per second.
  // The pre-step-2a calibration was 2 / 4 / 6 / 9 / 12, set against unreduced 10 m
  // met wind; step 2a put the boundary-layer reduction inside canyonModifiedWind(),
  // which dropped every street reading by ~40% and left that scale with 80% of the
  // map in two bands and the top two unreachable.
  it("classifies representative speeds", () => {
    expect(windBand(0).key).toBe("calm");
    expect(windBand(1.1).key).toBe("calm");
    expect(windBand(1.2).key).toBe("light");
    expect(windBand(2.47).key).toBe("moderate"); // the street-level median
    expect(windBand(4.95).key).toBe("strong"); //   the street-level p90
    expect(windBand(5).key).toBe("very_strong");
    expect(windBand(20).key).toBe("severe");
  });

  it("upper bound is exclusive (boundary goes to the next band)", () => {
    expect(windBand(2.4).key).toBe("moderate"); // 2.4 starts moderate, not light
    expect(windBand(3.6).key).toBe("strong");
    expect(windBand(7).key).toBe("severe");
  });

  it("clamps negative / non-finite to calm", () => {
    expect(windBand(-3).key).toBe("calm");
    expect(windBand(NaN).key).toBe("calm");
  });

  it("color comes from the matching band", () => {
    expect(windBandColor(2.9)).toEqual(WIND_BANDS.find((b) => b.key === "moderate")!.color);
  });
});

describe("routeImpact (headwind component)", () => {
  it("classifies head/tail/neutral", () => {
    expect(routeImpact(-7).key).toBe("strong_tailwind");
    expect(routeImpact(-3).key).toBe("tailwind");
    expect(routeImpact(0).key).toBe("neutral");
    expect(routeImpact(1.5).key).toBe("neutral");
    expect(routeImpact(3).key).toBe("headwind");
    expect(routeImpact(6).key).toBe("strong_headwind");
    expect(routeImpact(9).key).toBe("severe_headwind");
  });
});

describe("streetImpact (decompose onto street axis)", () => {
  it("wind flowing straight along the street is a full tailwind one way, headwind the other", () => {
    // Street axis 90° (E), wind flows toward 90° (eastward) at 6 m/s.
    const s = streetImpact(6, 90, 90);
    expect(s.alongMs).toBeCloseTo(6, 5);
    expect(s.favorableBearingDeg).toBe(90); // riding east is favorable
    expect(s.favorable.key).toBe("strong_tailwind"); // -6
    expect(s.against.key).toBe("strong_headwind"); //  +6
  });

  it("wind flowing opposite the axis flips the favorable direction", () => {
    // Axis 90° (E), wind flows toward 270° (westward).
    const s = streetImpact(6, 270, 90);
    expect(s.alongMs).toBeCloseTo(6, 5);
    expect(s.favorableBearingDeg).toBe(270); // riding west is favorable
  });

  it("pure crosswind has ~zero along-street component → neutral both ways", () => {
    // Axis 0° (N), wind flows toward 90° (E): perpendicular.
    const s = streetImpact(6, 90, 0);
    expect(s.alongMs).toBeCloseTo(0, 5);
    expect(s.favorable.key).toBe("neutral");
    expect(s.against.key).toBe("neutral");
  });

  it("45° wind splits to ~0.707 of the speed along the axis", () => {
    const s = streetImpact(6, 45, 0); // axis N, wind toward NE
    expect(s.alongMs).toBeCloseTo(6 * Math.cos(Math.PI / 4), 4);
  });
});

// ---------------------------------------------------------------------------
// Step 3: the recalibrated bands must actually spread the map out. A scale is
// dead if one band swallows everything or a band never lights up.
// ---------------------------------------------------------------------------

describe("band occupancy over Copenhagen's wind climate", () => {
  // Copenhagen's 10 m wind is well described by Weibull(k = 2, c = 6.1), annual
  // mean ~5.4 m/s. Sampled over a median-λ street (H/W = 6.8/20 = 0.34) with
  // orientation uniform, which is what the map actually shows.
  function occupancy(n = 120_000) {
    let seed = 0x1f2e3d4c;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const canyon = { heightM: 6.8, widthM: 20 };
    const counts = new Map<string, number>(WIND_BANDS.map((b) => [b.key, 0]));
    for (let i = 0; i < n; i++) {
      // Weibull(k, c) by inverse CDF: c * (-ln U)^(1/k).
      const ambient = 6.1 * Math.pow(-Math.log(1 - rand()), 1 / 2);
      const street = rand() * 360;
      const dir = rand() * 360;
      const w = canyonModifiedWind(street, canyon, { speedMs: ambient, directionDeg: dir });
      const k = windBand(w.speedMs).key;
      counts.set(k, counts.get(k)! + 1);
    }
    return new Map([...counts].map(([k, v]) => [k, (100 * v) / n]));
  }

  it("puts no band below 1% or above 40% of the map", () => {
    const occ = occupancy();
    const report = WIND_BANDS.map((b) => `${b.label} ${occ.get(b.key)!.toFixed(1)}%`).join(", ");
    for (const b of WIND_BANDS) {
      const share = occ.get(b.key)!;
      expect(share, `${b.label} holds ${share.toFixed(1)}% — ${report}`).toBeGreaterThanOrEqual(1);
      expect(share, `${b.label} holds ${share.toFixed(1)}% — ${report}`).toBeLessThanOrEqual(40);
    }
    // Shares must sum to 100 — proves every sample landed in exactly one band.
    const total = [...occ.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("the pre-step-2a thresholds would fail the same test", () => {
    // 2 / 4 / 6 / 9 / 12 against post-step-2a street wind: the top bands go dark.
    const OLD = [2, 4, 6, 9, 12, Infinity];
    let seed = 0x1f2e3d4c;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const canyon = { heightM: 6.8, widthM: 20 };
    const n = 120_000;
    const counts = new Array(OLD.length).fill(0);
    for (let i = 0; i < n; i++) {
      const ambient = 6.1 * Math.pow(-Math.log(1 - rand()), 1 / 2);
      const w = canyonModifiedWind(rand() * 360, canyon, { speedMs: ambient, directionDeg: rand() * 360 });
      counts[OLD.findIndex((t) => w.speedMs < t)]++;
    }
    const shares = counts.map((c) => (100 * c) / n);
    expect(Math.max(...shares)).toBeGreaterThan(40); // one band swallows the map
    expect(Math.min(...shares)).toBeLessThan(1); //    and the top ones never light up
  });
});
