// src/cyclist/windCategory.ts
// Single source of truth for cyclist-facing wind categories.
//
// Two complementary classifications:
//   1. SHELTER bands   — how much of today's wind reaches this street, as a ratio
//                        of the ambient. Drives the map arrow colors and the legend.
//                        NOT an absolute speed — see shelterRatio().
//   2. ROUTE IMPACT    — head/tail/cross relative to a direction of travel.
//                        Drives route planning ("is this street with or against me").
//
// The map shows one ambient at a time, so an absolute scale wastes most of its range:
// on the real network the street/ambient spread is fixed at 2.83x whatever the weather
// is doing, and at a live 4.4 m/s 92.2% of arrows fell into two adjacent bands. The
// ratio has the same distribution every day, because geometry sets it and not the
// weather, so a scale over ratio uses its full range daily. Absolute strength has not
// gone away: the header carries it, the tooltip prints it in m/s beside the band, and
// cyclist/advisory.ts owns hazard, so no safety signal rides on arrow colour.

export type RGB = [number, number, number];

export interface WindBand {
  key: string;
  label: string;
  /** Inclusive lower bound on the shelter ratio (street speed / ambient). */
  minRatio: number;
  /** Exclusive upper bound on the shelter ratio (Infinity for the top band). */
  maxRatio: number;
  color: RGB;
  /** One-line cyclist-facing meaning. */
  blurb: string;
}

// BOUNDS ARE SHELTER RATIOS, NOT SPEEDS. Each one is streetSpeed / ambientSpeed, so the
// scale answers "which streets are sheltered today" rather than "how windy is it".
// Measured against the shipped tiles in public/data/segtiles pooled over 24 wind
// directions — see the occupancy test in windCategory.test.ts, which is pinned to that
// real data. Do NOT recalibrate these against a modelled wind distribution; a synthetic
// climate is what produced the previous, dead scale.
//
// 0.60 is the reference: URBAN_BL_CORRECTION with no canyon, i.e. an open street. Every
// segment on the lambda < 0.1 early return lands exactly there. Below 0.60 the canyon is
// blocking wind; above it the canyon is channelling wind along the street — the physical
// story the app has always claimed and never shown.
//
// Open is deliberately the narrowest band, 0.595–0.605. That value is a POINT MASS, not a
// spread: 24.2% of the shipped network sits at exactly 0.600, so a wide Open band swallows
// the map (0.58–0.63 measured 37.8%) while adding almost nothing but that one spike. The
// band must straddle 0.600 and must never be cut through it, so the only way to give the
// other five bands room is to keep it tight. Measured shares over the shipped tiles pooled
// across 24 wind directions:
//
//   Deeply sheltered  9.7%   Sheltered 21.7%   Partly sheltered 17.7%
//   Open             26.6%   Channelled 15.4%  Strongly channelled 9.0%
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
  { key: "deeply_sheltered", label: "Deeply sheltered", minRatio: 0, maxRatio: 0.35, color: [130, 142, 202], blurb: "Buildings block almost all of today's wind." },
  { key: "sheltered", label: "Sheltered", minRatio: 0.35, maxRatio: 0.5, color: [106, 118, 185], blurb: "Well shielded; you will barely feel it." },
  { key: "partly_sheltered", label: "Partly sheltered", minRatio: 0.5, maxRatio: 0.595, color: [83, 94, 168], blurb: "Some shelter from the buildings." },
  { key: "open", label: "Open", minRatio: 0.595, maxRatio: 0.605, color: [62, 70, 150], blurb: "About the open-air wind at street level." },
  { key: "channelled", label: "Channelled", minRatio: 0.605, maxRatio: 0.66, color: [43, 45, 133], blurb: "The street funnels wind along its axis." },
  { key: "strongly_channelled", label: "Strongly channelled", minRatio: 0.66, maxRatio: Infinity, color: [27, 15, 115], blurb: "Buildings accelerate the wind down this street." },
];

/**
 * An open street with no canyon: URBAN_BL_CORRECTION and nothing else. Doubles as
 * the fallback when there is no usable ambient to divide by.
 */
export const OPEN_STREET_RATIO = 0.6;

/**
 * How much of the ambient wind reaches this street, as street / ambient.
 *
 * Below OPEN_STREET_RATIO the canyon is blocking wind; above it the canyon is
 * channelling wind along the street axis. Guarded at a near-calm ambient, where the
 * quotient is meaningless and unbounded: a becalmed city is uniformly open, not
 * uniformly sheltered, so it reports the open-street reference.
 */
export function shelterRatio(streetSpeedMs: number, ambientSpeedMs: number): number {
  if (!Number.isFinite(ambientSpeedMs) || ambientSpeedMs < 0.1) return OPEN_STREET_RATIO;
  if (!Number.isFinite(streetSpeedMs)) return OPEN_STREET_RATIO;
  return Math.max(0, streetSpeedMs / ambientSpeedMs);
}

/**
 * Shelter band for a ratio from shelterRatio() — NOT a speed in m/s. Handing this a
 * raw speed reads as "strongly channelled" for anything above 0.7 and fails silently,
 * so every call site pairs it with shelterRatio().
 */
export function windBand(ratio: number): WindBand {
  const v = Number.isFinite(ratio) ? Math.max(0, ratio) : OPEN_STREET_RATIO;
  for (const b of WIND_BANDS) if (v < b.maxRatio) return b;
  return WIND_BANDS[WIND_BANDS.length - 1];
}

/** Discrete band color for the map arrows, from a shelter ratio. */
export function windBandColor(ratio: number): RGB {
  return windBand(ratio).color;
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
// ui.ts. It deliberately shares no colour with WIND_BANDS above: this scale is signed
// along-route m/s and means direction, that one is a shelter ratio and means magnitude,
// and both are on screen at once — see the collision gate in windCategory.test.ts.
// Bounds here are m/s and stay absolute.
//
// The old green arm against the orange/red arm collapsed under deuteranopia: strong
// tailwind vs severe headwind — the two extremes — measured OKLab ΔE 5.0, i.e. the
// same colour. Here the worst tailwind-vs-headwind pair measures 13.3 and adjacent
// pairs clear 9.9.
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

/**
 * The band's label, except that inside the neutral band a clear along-street component is
 * named for what it is: 1.5 m/s along the street is a light headwind or tailwind, not a
 * crosswind. The band and its colour do not change.
 */
export function impactLabel(band: RouteImpactBand, headwindMs: number): string {
  if (band.key !== "neutral" || Math.abs(headwindMs) <= 0.5) return band.label;
  return headwindMs > 0 ? "Light headwind" : "Light tailwind";
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
