// src/cyclist/windCategory.test.ts
import { describe, it, expect } from "vitest";
import {
  WIND_BANDS,
  ROUTE_IMPACTS,
  windBand,
  windBandColor,
  shelterRatio,
  OPEN_STREET_RATIO,
  routeImpact,
  impactLabel,
  streetImpact,
  type RGB,
} from "./windCategory";
import { computeSegmentCenterWind, type SegmentInput, type GeometrySource } from "../math";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("windBand (shelter ratio)", () => {
  it("bands are contiguous and cover 0..∞", () => {
    expect(WIND_BANDS[0].minRatio).toBe(0);
    for (let i = 1; i < WIND_BANDS.length; i++) {
      expect(WIND_BANDS[i].minRatio).toBe(WIND_BANDS[i - 1].maxRatio);
    }
    expect(WIND_BANDS[WIND_BANDS.length - 1].maxRatio).toBe(Infinity);
  });

  it("the Open band straddles the open-street reference without cutting it", () => {
    // 0.60 is a point mass — 24.2% of the network sits exactly there — so a cut
    // landing on it would split one physical situation across two colours.
    const open = WIND_BANDS.find((b) => b.key === "open")!;
    expect(open.minRatio).toBeLessThan(OPEN_STREET_RATIO);
    expect(open.maxRatio).toBeGreaterThan(OPEN_STREET_RATIO);
    for (const b of WIND_BANDS) {
      if (b.minRatio !== 0) expect(b.minRatio).not.toBeCloseTo(OPEN_STREET_RATIO, 9);
    }
  });

  // Bounds are ratios of the ambient wind, not m/s. The scale before this one used
  // absolute rider-height speeds (1.2 / 2.4 / 3.6 / 5 / 7), and before that
  // met-station speeds (2 / 4 / 6 / 9 / 12). Both answered "how windy is it", which
  // the header already answers; this one answers "which streets are sheltered".
  it("classifies representative ratios", () => {
    expect(windBand(0).key).toBe("deeply_sheltered");
    expect(windBand(0.2).key).toBe("deeply_sheltered");
    expect(windBand(0.4).key).toBe("sheltered");
    expect(windBand(0.55).key).toBe("partly_sheltered");
    expect(windBand(0.6).key).toBe("open"); //     the open-street reference
    expect(windBand(0.62).key).toBe("channelled");
    expect(windBand(0.85).key).toBe("strongly_channelled");
  });

  it("upper bound is exclusive (boundary goes to the next band)", () => {
    expect(windBand(0.35).key).toBe("sheltered");
    expect(windBand(0.5).key).toBe("partly_sheltered");
    expect(windBand(0.605).key).toBe("channelled");
    expect(windBand(0.66).key).toBe("strongly_channelled");
  });

  it("clamps a negative ratio down and falls back to open when it is not a number", () => {
    expect(windBand(-3).key).toBe("deeply_sheltered");
    // A missing ratio means "we could not tell", which is the open reference — not
    // "deeply sheltered", which would paint unknown streets as the calmest thing there is.
    expect(windBand(NaN).key).toBe("open");
  });

  it("color comes from the matching band", () => {
    expect(windBandColor(0.55)).toEqual(WIND_BANDS.find((b) => b.key === "partly_sheltered")!.color);
  });
});

describe("shelterRatio", () => {
  it("is scale invariant — the same geometry reads the same on a calm and a wild day", () => {
    // This is the whole point of the change: colour must not drift with the weather.
    expect(windBand(shelterRatio(2.64, 4.4)).key).toBe(windBand(shelterRatio(6.0, 10.0)).key);
    expect(shelterRatio(2.64, 4.4)).toBeCloseTo(0.6, 9);
    expect(shelterRatio(6.0, 10.0)).toBeCloseTo(0.6, 9);
  });

  it("puts an open street in the Open band at every ambient", () => {
    for (let a = 1; a <= 15; a++) {
      const r = shelterRatio(OPEN_STREET_RATIO * a, a);
      expect(r, `ambient ${a} gave ratio ${r}`).toBeCloseTo(OPEN_STREET_RATIO, 9);
      expect(windBand(r).key, `ambient ${a}`).toBe("open");
    }
  });

  it("does not divide by a near-calm ambient", () => {
    expect(() => shelterRatio(0, 0)).not.toThrow();
    expect(shelterRatio(0, 0)).toBe(OPEN_STREET_RATIO);
    expect(shelterRatio(0.05, 0.05)).toBe(OPEN_STREET_RATIO); // below the 0.1 guard
    expect(shelterRatio(1, NaN)).toBe(OPEN_STREET_RATIO);
    expect(Number.isFinite(shelterRatio(3, 0.0001))).toBe(true);
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

// Real segment geometry, straight off the tiles the app ships and loads. The previous
// scale was calibrated against a modelled wind climate and died on contact with the
// data, so this one is pinned to the data instead.
const GEOM_SRC: GeometrySource[] = ["measured", "partial", "fallback"];
type SegTuple = [number, number, number, number, number, number, number, number, number, string | number | null];

function loadShippedSegments(): SegmentInput[] {
  const dir = join(process.cwd(), "public", "data", "segtiles");
  const out: SegmentInput[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const tuples = JSON.parse(readFileSync(join(dir, file), "utf8")) as SegTuple[];
    for (const [lon, lat, bearingDeg, segLen, leftDist, rightDist, leftH, rightH, geomSrc] of tuples) {
      const widthM = leftDist + rightDist;
      out.push({
        lon, lat, bearingDeg, segmentLengthM: segLen, widthM,
        leftDistM: leftDist, rightDistM: rightDist,
        leftHeightM: leftH, rightHeightM: rightH,
        canyonH: (leftH + rightH) / 2, canyonW: widthM,
        laneOffsetsM: [0, 0, 0, 0, 0],
        geometrySource: GEOM_SRC[geomSrc] ?? "fallback",
      });
    }
  }
  return out;
}

describe("band occupancy on the shipped network", () => {
  const segments = loadShippedSegments();
  const AMBIENT = 5; // any value: the ratio distribution does not depend on it
  const DIRECTIONS = Array.from({ length: 24 }, (_, i) => i * 15);

  function occupancy(ambient: number) {
    const counts = new Map<string, number>(WIND_BANDS.map((b) => [b.key, 0]));
    let n = 0;
    for (const directionDeg of DIRECTIONS) {
      for (const seg of segments) {
        const w = computeSegmentCenterWind(seg, { speedMs: ambient, directionDeg });
        const k = windBand(shelterRatio(w.speedMs, ambient)).key;
        counts.set(k, counts.get(k)! + 1);
        n++;
      }
    }
    return new Map([...counts].map(([k, v]) => [k, (100 * v) / n]));
  }

  it("reads real tiles, not a synthetic distribution", () => {
    expect(segments.length).toBeGreaterThan(50_000);
  });

  it("puts no band below 4% or above 35% of the map", () => {
    const occ = occupancy(AMBIENT);
    const report = WIND_BANDS.map((b) => `${b.label} ${occ.get(b.key)!.toFixed(1)}%`).join(", ");
    for (const b of WIND_BANDS) {
      const share = occ.get(b.key)!;
      expect(share, `${b.label} holds ${share.toFixed(1)}% — ${report}`).toBeGreaterThanOrEqual(4);
      expect(share, `${b.label} holds ${share.toFixed(1)}% — ${report}`).toBeLessThanOrEqual(35);
    }
    expect([...occ.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("gives the same picture whatever the wind is doing", () => {
    // Geometry fixes the ratio, so a 2 m/s day and an 11 m/s day colour identically.
    // An absolute scale could not do this — it was the reason the old one showed
    // two colours at the live wind.
    // 3 decimals of a percentage: a segment sitting on a band edge can cross it on
    // floating-point noise at a different ambient, and one segment in 2.8 million
    // evaluations is 3.5e-5 %.
    const calm = occupancy(2), wild = occupancy(11);
    for (const b of WIND_BANDS) {
      expect(calm.get(b.key)!, b.label).toBeCloseTo(wild.get(b.key)!, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 3b: the four gates the first palette pass missed. The map ramp encodes
// magnitude and ROUTE_IMPACTS encodes direction; both are on screen at once, so
// they must not look alike. Arrows are ~8px glyphs, so WCAG 1.4.11's 3:1 for
// graphical objects applies — the 2:1 ordinal light-end floor is not enough.
// ---------------------------------------------------------------------------

const srgbToLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

/** WCAG relative luminance. */
function relLuminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map(srgbToLinear);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG contrast ratio against white, which is lighter than every band. */
const contrastVsWhite = (c: RGB): number => 1.05 / (relLuminance(c) + 0.05);

/** OKLab, the perceptually uniform space the ΔE floors are measured in. */
function oklab([r, g, b]: RGB): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Euclidean distance in OKLab, ×100 — the same scale the dataviz gates use. */
function deltaE(a: RGB, b: RGB): number {
  const [al, aa, ab] = oklab(a), [bl, ba, bb] = oklab(b);
  return 100 * Math.hypot(al - bl, aa - ba, ab - bb);
}

const hex = (c: RGB) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

describe("WIND_BANDS palette gates", () => {
  it("every band clears 3:1 against a white road (WCAG 1.4.11)", () => {
    // Arrows are graphical objects, not text, and they draw over #ffffff roads.
    // The rust ramp this replaced put Calm at 2.13:1 and Light at 2.95:1 —
    // together 48.2% of the map sitting below the floor.
    for (const b of WIND_BANDS) {
      const ratio = contrastVsWhite(b.color);
      expect(ratio, `${b.label} ${hex(b.color)} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("no band is confusable with a panel headwind colour", () => {
    // Magnitude must not read as direction. The rust ramp put map Moderate at
    // ΔE 0.8 from panel Headwind and map Strong at 1.4 from Strong headwind —
    // the same colour carrying two different meanings on one screen.
    const headwinds = ROUTE_IMPACTS.filter((r) => r.key.includes("headwind"));
    expect(headwinds).toHaveLength(3);
    let worst = Infinity, pair = "";
    for (const b of WIND_BANDS) {
      for (const h of headwinds) {
        const d = deltaE(b.color, h.color);
        if (d < worst) { worst = d; pair = `map ${b.label} ${hex(b.color)} vs panel ${h.label} ${hex(h.color)}`; }
      }
    }
    expect(worst, `closest pair is ${pair} at ΔE ${worst.toFixed(1)}`).toBeGreaterThanOrEqual(12);
  });

  it("lightness decreases strictly down the ramp", () => {
    // Order lives in lightness, which is the part colour blindness leaves intact.
    const Ls = WIND_BANDS.map((b) => oklab(b.color)[0]);
    for (let i = 1; i < Ls.length; i++) {
      expect(Ls[i], `${WIND_BANDS[i].label} L ${Ls[i].toFixed(3)} vs ${WIND_BANDS[i - 1].label} L ${Ls[i - 1].toFixed(3)}`)
        .toBeLessThan(Ls[i - 1]);
    }
  });

  it("adjacent bands stay apart", () => {
    for (let i = 1; i < WIND_BANDS.length; i++) {
      const d = deltaE(WIND_BANDS[i - 1].color, WIND_BANDS[i].color);
      expect(d, `${WIND_BANDS[i - 1].label} -> ${WIND_BANDS[i].label} is ΔE ${d.toFixed(1)}`)
        .toBeGreaterThanOrEqual(7);
    }
  });
});

describe("impactLabel", () => {
  // Inside the ±2 m/s neutral band a clear along-street component is named; the band
  // itself (and its colour) stays neutral.
  it("names a light headwind or tailwind inside the neutral band", () => {
    expect(impactLabel(routeImpact(1.5), 1.5)).toBe("Light headwind");
    expect(impactLabel(routeImpact(-1.5), -1.5)).toBe("Light tailwind");
  });
  it("keeps 'Neutral / crosswind' within ±0.5 m/s", () => {
    expect(impactLabel(routeImpact(0.3), 0.3)).toBe("Neutral / crosswind");
    expect(impactLabel(routeImpact(-0.5), -0.5)).toBe("Neutral / crosswind");
  });
  it("leaves every other band's label alone", () => {
    expect(impactLabel(routeImpact(3), 3)).toBe("Headwind");
    expect(impactLabel(routeImpact(-3), -3)).toBe("Tailwind");
  });
});
