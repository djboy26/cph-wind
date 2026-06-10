// src/cyclist/windCategory.ts
// Single source of truth for cyclist-facing wind categories.
//
// Two complementary classifications:
//   1. STRENGTH bands  — how strong the wind is on a street (magnitude, m/s).
//                        Drives the map arrow colors and the legend.
//   2. ROUTE IMPACT    — head/tail/cross relative to a direction of travel.
//                        Drives route planning ("is this street with or against me").
//
// Grounding: Beaufort scale boundaries, adapted for cycling. A headwind adds to
// the rider's own air speed and aerodynamic effort scales with its square, so the
// low end is meaningful and bands widen as they climb. Speeds are street-level
// (what a rider feels — the canyon-modified value the map already shows), not the
// 10 m meteorological value used by the accuracy harness.

export type RGB = [number, number, number];

export interface WindBand {
  key: string;
  label: string;
  /** Inclusive lower bound, m/s. */
  minMs: number;
  /** Exclusive upper bound, m/s (Infinity for the top band). */
  maxMs: number;
  color: RGB;
  /** One-line cyclist-facing meaning. */
  blurb: string;
}

// Cool→hot sequential ramp, tuned for contrast and harmony on the warm-white
// Daylight canvas (the calm grey of the old dark theme would vanish here).
export const WIND_BANDS: WindBand[] = [
  { key: "calm", label: "Calm", minMs: 0, maxMs: 2, color: [99, 148, 166], blurb: "Wind is not a factor." },
  { key: "light", label: "Light", minMs: 2, maxMs: 4, color: [60, 165, 120], blurb: "Easy riding; a slight push or resistance." },
  { key: "moderate", label: "Moderate", minMs: 4, maxMs: 6, color: [224, 168, 38], blurb: "Noticeable effort into a headwind." },
  { key: "strong", label: "Strong", minMs: 6, maxMs: 9, color: [228, 118, 40], blurb: "Hard work into a headwind; affects pace." },
  { key: "very_strong", label: "Very strong", minMs: 9, maxMs: 12, color: [212, 58, 52], blurb: "Tough; gusts can affect balance." },
  { key: "severe", label: "Severe", minMs: 12, maxMs: Infinity, color: [158, 46, 104], blurb: "Hazardous. Best avoided." },
];

/** Strength band for a street-level wind speed (m/s). */
export function windBand(speedMs: number): WindBand {
  const v = Number.isFinite(speedMs) ? Math.max(0, speedMs) : 0;
  for (const b of WIND_BANDS) if (v < b.maxMs) return b;
  return WIND_BANDS[WIND_BANDS.length - 1];
}

/** Discrete band color for the map arrows. */
export function windBandColor(speedMs: number): RGB {
  return windBand(speedMs).color;
}

// ---------------- Route impact (head / tail / cross) ----------------

export interface RouteImpactBand {
  key: string;
  label: string;
  /** Bounds on the signed along-route component, m/s (+ = headwind, − = tailwind). */
  minMs: number;
  maxMs: number;
  color: RGB;
}

// Classified on the headwind component h (+ opposes travel, − aids it). The ±2 m/s
// neutral band absorbs near-pure crosswinds (little along-route effect either way).
export const ROUTE_IMPACTS: RouteImpactBand[] = [
  { key: "strong_tailwind", label: "Strong tailwind", minMs: -Infinity, maxMs: -5, color: [31, 140, 84] },
  { key: "tailwind", label: "Tailwind", minMs: -5, maxMs: -2, color: [96, 178, 116] },
  { key: "neutral", label: "Neutral / crosswind", minMs: -2, maxMs: 2, color: [120, 150, 165] },
  { key: "headwind", label: "Headwind", minMs: 2, maxMs: 5, color: [224, 150, 52] },
  { key: "strong_headwind", label: "Strong headwind", minMs: 5, maxMs: 8, color: [220, 92, 46] },
  { key: "severe_headwind", label: "Severe headwind", minMs: 8, maxMs: Infinity, color: [188, 40, 52] },
];

/** Route-impact band for a signed headwind component (+ = against travel). */
export function routeImpact(headwindMs: number): RouteImpactBand {
  for (const b of ROUTE_IMPACTS) if (headwindMs < b.maxMs) return b;
  return ROUTE_IMPACTS[ROUTE_IMPACTS.length - 1];
}

const DEG = Math.PI / 180;

export interface StreetImpact {
  /** Magnitude of the along-street wind component, m/s (≥ 0). */
  alongMs: number;
  /** Compass bearing the wind favors riding toward (tailwind that way). */
  favorableBearingDeg: number;
  /** Route impact riding the favorable way (a tailwind band). */
  favorable: RouteImpactBand;
  /** Route impact riding the opposite way (a headwind band). */
  against: RouteImpactBand;
}

/**
 * Decompose an already-modified street wind (street-level speed + flow direction)
 * onto a street axis to get the cyclist route impact for each travel direction.
 *
 * @param speedMs    street-level wind speed (m/s)
 * @param flowDeg    compass direction the wind flows TOWARD (deg CW from N)
 * @param bearingDeg the street axis A→B (deg CW from N)
 */
export function streetImpact(speedMs: number, flowDeg: number, bearingDeg: number): StreetImpact {
  // Component of the wind along the street axis; + means it flows toward `bearing`.
  const along = speedMs * Math.cos((flowDeg - bearingDeg) * DEG);
  const alongMs = Math.abs(along);
  const favorableBearingDeg = along >= 0 ? bearingDeg : (bearingDeg + 180) % 360;
  return {
    alongMs,
    favorableBearingDeg,
    favorable: routeImpact(-alongMs), // riding with the wind → tailwind (negative h)
    against: routeImpact(alongMs), //    riding against it → headwind (positive h)
  };
}
