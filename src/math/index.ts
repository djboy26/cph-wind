// src/math/index.ts
// Pure functions for wind resistance calculations.
// No side effects, no dependencies. All angles in degrees CW from north.

export interface LonLat {
  lon: number;
  lat: number;
}

export interface Wind {
  /** Wind speed at 10m height in m/s (Open-Meteo's reported value). */
  speedMs: number;
  /** Meteorological direction in degrees: the direction the wind blows FROM. */
  directionDeg: number;
  /** Optional gust speed in m/s. */
  gustMs?: number;
}

export interface SegmentResistance {
  /**
   * Wind component along the street A→B direction, in m/s.
   * Positive = cyclist faces headwind. Negative = tailwind.
   */
  headwindMs: number;
  /** Unsigned wind component perpendicular to the street, in m/s. */
  crosswindMs: number;
}

export interface AlongStreet {
  /** Compass direction (deg CW from N) the wind flows along this street segment. */
  angleDeg: number;
  /** Magnitude of wind component along the street, m/s (always ≥ 0). */
  magnitudeMs: number;
}

export interface CanyonGeometry {
  /** Mean adjacent building height, meters. 0 = no buildings nearby. */
  heightM: number;
  /** Street width between flanking buildings, meters. */
  widthM: number;
}

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const URBAN_BL_CORRECTION = 0.6;

/**
 * Bearing from point A to point B, degrees CW from north, range [0, 360).
 * Applies cos(meanLat) correction for meridian convergence.
 */
export function bearing(a: LonLat, b: LonLat): number {
  const meanLat = ((a.lat + b.lat) / 2) * DEG;
  const dx = (b.lon - a.lon) * Math.cos(meanLat);
  const dy = b.lat - a.lat;
  let theta = Math.atan2(dx, dy) * RAD;
  if (theta < 0) theta += 360;
  return theta;
}

/** Componentwise midpoint of two coordinates. */
export function midpoint(a: LonLat, b: LonLat): LonLat {
  return {
    lon: (a.lon + b.lon) / 2,
    lat: (a.lat + b.lat) / 2,
  };
}

/** Convert 10m wind speed to approximate street-level wind (open-area assumption). */
export function streetLevelWind(speed10m: number): number {
  return speed10m * URBAN_BL_CORRECTION;
}

/**
 * Decompose wind into headwind (signed, along A→B) and crosswind (unsigned, perpendicular)
 * components for a cyclist travelling A→B.
 */
export function resistance(streetBearingDeg: number, wind: Wind): SegmentResistance {
  const v = streetLevelWind(wind.speedMs);
  const thetaTravel = ((wind.directionDeg + 180) % 360) * DEG;
  const Wx = v * Math.sin(thetaTravel);
  const Wy = v * Math.cos(thetaTravel);

  const thetaStreet = streetBearingDeg * DEG;
  const Sx = Math.sin(thetaStreet);
  const Sy = Math.cos(thetaStreet);

  const headwindMs = -(Wx * Sx + Wy * Sy);
  const crosswindMs = Math.abs(Wx * Sy - Wy * Sx);
  return { headwindMs, crosswindMs };
}

/**
 * Project wind onto street axis. Returns the compass direction wind flows
 * along the street and its scalar magnitude. Cyclist interpretation:
 * travelling in `angleDeg` direction yields a tailwind of `magnitudeMs`.
 */
export function alongStreetWind(streetBearingDeg: number, wind: Wind): AlongStreet {
  const v = streetLevelWind(wind.speedMs);
  const thetaTravel = ((wind.directionDeg + 180) % 360) * DEG;
  const Wx = v * Math.sin(thetaTravel);
  const Wy = v * Math.cos(thetaTravel);

  const thetaStreet = streetBearingDeg * DEG;
  const Sx = Math.sin(thetaStreet);
  const Sy = Math.cos(thetaStreet);

  const alongAB = Wx * Sx + Wy * Sy;
  if (alongAB >= 0) {
    return { angleDeg: streetBearingDeg, magnitudeMs: alongAB };
  }
  return {
    angleDeg: (streetBearingDeg + 180) % 360,
    magnitudeMs: -alongAB,
  };
}

/**
 * Apply Soulhac-style urban canyon channeling to modify a regional wind
 * vector based on the local geometry of a street.
 *
 * Wind is decomposed into along-canyon and across-canyon components.
 * The along component is amplified (channeling speedup); the across
 * component is attenuated (skimming flow blocks perpendicular flow at
 * street level). The vector is recombined into a new wind with rotated
 * direction and modified magnitude.
 *
 * - λ = H/W is the canyon aspect ratio.
 * - λ < 0.1:   ambient wind returned unchanged (open / very wide street).
 * - λ ≈ 0.36:  Copenhagen median — ~48% of cross-component blocked.
 * - λ ≳ 0.65:  skimming-flow regime — cross-component largely blocked, so the
 *              street-level wind aligns strongly with the street axis.
 * - λ ≥ 1.5:   cross-component ~95% blocked; wind funnels almost fully along.
 *
 * The cross attenuation is exponential in λ (not the gentle linear blend used
 * earlier, which barely rotated wind at Copenhagen's typical aspect ratios and
 * made every street read the same direction). This is what makes a wind-aligned
 * street flow fast-and-straight while a perpendicular street goes calm.
 *
 * Reference: Soulhac, Salizzoni, Cierco, Perkins (2008), Atmos Env 42(31).
 */
export function canyonModifiedWind(
  streetBearingDeg: number,
  canyon: CanyonGeometry,
  ambientWind: Wind,
): Wind {
  const lambda = canyon.widthM > 0 ? canyon.heightM / canyon.widthM : 0;

  if (lambda < 0.1 || ambientWind.speedMs <= 0) return ambientWind;

  const thetaTravel = ((ambientWind.directionDeg + 180) % 360) * DEG;
  const Wx = ambientWind.speedMs * Math.sin(thetaTravel);
  const Wy = ambientWind.speedMs * Math.cos(thetaTravel);

  const thetaStreet = streetBearingDeg * DEG;
  const Sx = Math.sin(thetaStreet);
  const Sy = Math.cos(thetaStreet);

  const wAlong = Wx * Sx + Wy * Sy;
  const wCrossX = Wx - wAlong * Sx;
  const wCrossY = Wy - wAlong * Sy;

  // Along-canyon channeling speedup (capped ~1.45 for deep canyons), and an
  // exponential cross-canyon blockage so skimming flow (λ≳0.65) funnels wind
  // along the street rather than across it.
  const alongFactor = 1 + 0.3 * Math.min(lambda, 1.5);
  const crossFactor = Math.max(0.05, Math.exp(-1.8 * lambda));

  const modX = wAlong * alongFactor * Sx + wCrossX * crossFactor;
  const modY = wAlong * alongFactor * Sy + wCrossY * crossFactor;

  const speedMs = Math.sqrt(modX * modX + modY * modY);
  if (speedMs < 1e-6) {
    return { speedMs: 0, directionDeg: ambientWind.directionDeg, gustMs: ambientWind.gustMs };
  }

  const travelDeg = (Math.atan2(modX, modY) * RAD + 360) % 360;
  const directionDeg = (travelDeg + 180) % 360;
  const gustScale = speedMs / ambientWind.speedMs;

  return {
    speedMs,
    directionDeg,
    gustMs: ambientWind.gustMs !== undefined ? ambientWind.gustMs * gustScale : undefined,
  };
}

export type GeometrySource = 'measured' | 'partial' | 'fallback';

export interface StreetCrossSection {
  widthM: number;
  leftDistM: number;
  rightDistM: number;
  leftHeightM: number;
  rightHeightM: number;
  laneOffsetsM: number[];
}

export interface LaneWind {
  offsetM: number;
  speedMs: number;
  /** Compass direction (deg CW from N) the wind flows at this lane. */
  flowDeg: number;
  /** Canyon-scaled gust speed at this lane, m/s (undefined if no gust reported). */
  gustMs?: number;
}

export interface SegmentInput {
  lon: number;
  lat: number;
  bearingDeg: number;
  segmentLengthM: number;
  widthM: number;
  leftDistM: number;
  rightDistM: number;
  leftHeightM: number;
  rightHeightM: number;
  canyonH: number;
  canyonW: number;
  laneOffsetsM: number[];
  geometrySource: GeometrySource;
}

const MPER_DEG_LAT = 111_000;

/** Lateral offset in meters (+ = right of travel) from midpoint lon/lat. */
export function offsetLonLat(mid: LonLat, bearingDeg: number, offsetM: number): LonLat {
  const brgRad = bearingDeg * DEG;
  const mPerDegLon = MPER_DEG_LAT * Math.cos(mid.lat * DEG);
  const eastM = offsetM * Math.cos(brgRad);
  const northM = -offsetM * Math.sin(brgRad);
  return {
    lon: mid.lon + eastM / mPerDegLon,
    lat: mid.lat + northM / MPER_DEG_LAT,
  };
}

/** Offset along street bearing from midpoint (for flow animation). */
export function offsetAlongBearing(mid: LonLat, bearingDeg: number, alongM: number): LonLat {
  const brgRad = bearingDeg * DEG;
  const mPerDegLon = MPER_DEG_LAT * Math.cos(mid.lat * DEG);
  const eastM = Math.sin(brgRad) * alongM;
  const northM = Math.cos(brgRad) * alongM;
  return {
    lon: mid.lon + eastM / mPerDegLon,
    lat: mid.lat + northM / MPER_DEG_LAT,
  };
}

function wallHeightAtOffset(cross: StreetCrossSection, offsetM: number): number {
  const span = cross.leftDistM + cross.rightDistM;
  if (span <= 0) return (cross.leftHeightM + cross.rightHeightM) / 2;
  const t = (offsetM + cross.leftDistM) / span;
  const clamped = Math.max(0, Math.min(1, t));
  return cross.leftHeightM * (1 - clamped) + cross.rightHeightM * clamped;
}

function laneLocalCanyon(cross: StreetCrossSection, offsetM: number): CanyonGeometry {
  const distLeft = cross.leftDistM + offsetM;
  const distRight = cross.rightDistM - offsetM;
  const localWidth = Math.max(distLeft, 0.5) + Math.max(distRight, 0.5);
  const heightM = wallHeightAtOffset(cross, offsetM);
  return { heightM, widthM: localWidth };
}

function windToFlowDeg(wind: Wind): number {
  return (wind.directionDeg + 180) % 360;
}

/**
 * Compute modified wind at a single lateral lane position using lane-local
 * canyon geometry (asymmetric walls, position-dependent width and height).
 */
export function asymmetricCanyonWindAtLane(
  streetBearingDeg: number,
  cross: StreetCrossSection,
  offsetM: number,
  ambientWind: Wind,
): LaneWind {
  const canyon = laneLocalCanyon(cross, offsetM);
  const modified = canyonModifiedWind(streetBearingDeg, canyon, ambientWind);
  return {
    offsetM,
    speedMs: modified.speedMs,
    flowDeg: windToFlowDeg(modified),
    gustMs: modified.gustMs,
  };
}

/** Compute wind vectors for all lane sample points on a segment. */
export function computeSegmentLanes(
  segment: SegmentInput,
  ambientWind: Wind,
): LaneWind[] {
  const cross: StreetCrossSection = {
    widthM: segment.widthM,
    leftDistM: segment.leftDistM,
    rightDistM: segment.rightDistM,
    leftHeightM: segment.leftHeightM,
    rightHeightM: segment.rightHeightM,
    laneOffsetsM: segment.laneOffsetsM,
  };
  return segment.laneOffsetsM.map((offsetM) =>
    asymmetricCanyonWindAtLane(segment.bearingDeg, cross, offsetM, ambientWind),
  );
}

/** Center-lane wind (lane index 2) for summary / single-arrow mode. */
export function computeSegmentCenterWind(segment: SegmentInput, ambientWind: Wind): LaneWind {
  const centerOffset = segment.laneOffsetsM[2] ?? 0;
  const cross: StreetCrossSection = {
    widthM: segment.widthM,
    leftDistM: segment.leftDistM,
    rightDistM: segment.rightDistM,
    leftHeightM: segment.leftHeightM,
    rightHeightM: segment.rightHeightM,
    laneOffsetsM: segment.laneOffsetsM,
  };
  return asymmetricCanyonWindAtLane(segment.bearingDeg, cross, centerOffset, ambientWind);
}