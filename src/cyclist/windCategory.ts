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

// THRESHOLDS ARE RIDER-HEIGHT (street-level) VALUES, m/s. Recalibrated once step 2a
// applied the boundary-layer reduction inside canyonModifiedWind(). Over Copenhagen's
// wind climate — Weibull(k = 2, c = 6.1) at the 10 m met reference — a median-λ street
// now sees a median of 2.47 m/s and a p90 of 4.95 m/s.
//
// The previous 2 / 4 / 6 / 9 / 12 scale was calibrated against unreduced 10 m wind. Left
// alone after step 2a it put 80% of the map in two bands and made the top two unreachable
// (Severe needed a 13.8 m/s ambient even in the deepest aligned canyon). Do NOT "correct"
// these back up to met-station numbers — they are deliberately lower.
//
// One-hue ordinal ramp: indigo, OKLab lightness 0.661→0.280 in even steps. Wind strength
// is an ordered magnitude, so the scale carries its order in lightness rather than touring
// hues — the teal→green→amber→orange→magenta ramp this replaced was not even monotonic
// (Moderate sat lighter than Calm), and its two busiest bands measured OKLab ΔE 7.5 under
// deuteranopia, i.e. one colour.
//
// Indigo specifically, for two measured reasons. Both are pinned as gates in
// windCategory.test.ts — do not repalette this ramp without re-running them.
//   1. Arrows are ~8 px graphical objects over white roads, so WCAG 1.4.11 asks for 3:1,
//      not the 2:1 floor a sequential ramp light end would otherwise get. A rust ramp
//      tried first put Calm at 2.13:1 and Light at 2.95:1 — together 48.2% of the map
//      below the floor. Indigo runs 3.15:1 (Calm) to 15.41:1 (Severe).
//   2. ROUTE_IMPACTS below encodes *direction* in teal ↔ rust and is on screen at the
//      same time as this ramp, which encodes *magnitude*. A rust ramp collided with it:
//      map Moderate sat ΔE 0.8 from panel Headwind, and map Strong 1.4 from Strong
//      headwind. The indigo ramp is 19.1 from the nearest panel headwind colour.
// Indigo also stays clear of the basemap, which spends teal on water and green on parks.
// Adjacent ΔE 7.7, carried on lightness — the channel colour blindness leaves intact.
export const WIND_BANDS: WindBand[] = [
  { key: "calm", label: "Calm", minMs: 0, maxMs: 1.2, color: [130, 142, 202], blurb: "Wind is not a factor." },
  { key: "light", label: "Light", minMs: 1.2, maxMs: 2.4, color: [106, 118, 185], blurb: "Easy riding; a slight push or resistance." },
  { key: "moderate", label: "Moderate", minMs: 2.4, maxMs: 3.6, color: [83, 94, 168], blurb: "Noticeable effort into a headwind." },
  { key: "strong", label: "Strong", minMs: 3.6, maxMs: 5, color: [62, 70, 150], blurb: "Hard work into a headwind; affects pace." },
  { key: "very_strong", label: "Very strong", minMs: 5, maxMs: 7, color: [43, 45, 133], blurb: "Tough; gusts can affect balance." },
  { key: "severe", label: "Severe", minMs: 7, maxMs: Infinity, color: [27, 15, 115], blurb: "Hazardous. Best avoided." },
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
// Diverging teal ↔ rust about a light neutral midpoint, matching COLORS.good/bad in
// ui.ts so the panel and the map agree on what a headwind looks like. The old green
// arm against the orange/red arm collapsed under deuteranopia: strong tailwind vs
// severe headwind — the two extremes — measured OKLab ΔE 5.0, i.e. the same colour.
// Here the worst tailwind-vs-headwind pair measures 13.3 and adjacent pairs clear 9.9.
export const ROUTE_IMPACTS: RouteImpactBand[] = [
  { key: "strong_tailwind", label: "Strong tailwind", minMs: -Infinity, maxMs: -5, color: [0, 90, 112] },
  { key: "tailwind", label: "Tailwind", minMs: -5, maxMs: -2, color: [68, 136, 156] },
  { key: "neutral", label: "Neutral / crosswind", minMs: -2, maxMs: 2, color: [170, 167, 162] },
  { key: "headwind", label: "Headwind", minMs: 2, maxMs: 5, color: [182, 105, 71] },
  { key: "strong_headwind", label: "Strong headwind", minMs: 5, maxMs: 8, color: [159, 67, 29] },
  { key: "severe_headwind", label: "Severe headwind", minMs: 8, maxMs: Infinity, color: [117, 40, 21] },
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
