// src/cyclist/windCategory.test.ts
import { describe, it, expect } from "vitest";
import {
  WIND_BANDS,
  windBand,
  windBandColor,
  routeImpact,
  streetImpact,
} from "./windCategory";

describe("windBand (strength)", () => {
  it("bands are contiguous and cover 0..∞", () => {
    expect(WIND_BANDS[0].minMs).toBe(0);
    for (let i = 1; i < WIND_BANDS.length; i++) {
      expect(WIND_BANDS[i].minMs).toBe(WIND_BANDS[i - 1].maxMs);
    }
    expect(WIND_BANDS[WIND_BANDS.length - 1].maxMs).toBe(Infinity);
  });

  it("classifies representative speeds", () => {
    expect(windBand(0).key).toBe("calm");
    expect(windBand(1.9).key).toBe("calm");
    expect(windBand(2).key).toBe("light");
    expect(windBand(5).key).toBe("moderate");
    expect(windBand(8.9).key).toBe("strong");
    expect(windBand(11).key).toBe("very_strong");
    expect(windBand(20).key).toBe("severe");
  });

  it("upper bound is exclusive (boundary goes to the next band)", () => {
    expect(windBand(4).key).toBe("moderate"); // 4 is the start of moderate, not light
    expect(windBand(6).key).toBe("strong");
  });

  it("clamps negative / non-finite to calm", () => {
    expect(windBand(-3).key).toBe("calm");
    expect(windBand(NaN).key).toBe("calm");
  });

  it("color comes from the matching band", () => {
    expect(windBandColor(5)).toEqual(WIND_BANDS.find((b) => b.key === "moderate")!.color);
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
