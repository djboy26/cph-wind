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
     * Positive = cyclist faces headwind of this magnitude.
     * Negative = cyclist has tailwind of |value| magnitude.
     */
    headwindMs: number;
    /** Unsigned wind component perpendicular to the street, in m/s. */
    crosswindMs: number;
  }
  
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  
  /**
   * Empirical correction factor to convert 10m wind to street-level (~1.5m)
   * wind in a mid-rise European urban environment.
   *
   * The log-wind-profile breaks down inside the urban canopy, so we use a
   * flat scalar rather than a formal boundary-layer formula. Calibrate later
   * against ground-station data if available.
   */
  const URBAN_BL_CORRECTION = 0.6;
  
  /**
   * Bearing from point A to point B, in degrees clockwise from north, range [0, 360).
   *
   * Applies a cosine correction at mean latitude to account for meridian
   * convergence. Accurate to <0.1° for segments under a few km at any latitude.
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
  
  /** Convert 10m wind speed to approximate street-level wind. */
  export function streetLevelWind(speed10m: number): number {
    return speed10m * URBAN_BL_CORRECTION;
  }
  
  /**
   * Decompose wind into along-street (headwind/tailwind) and across-street
   * (crosswind) components for a cyclist travelling from A to B along a street
   * with the given bearing.
   *
   * Math:
   *   Wind travel vector (direction air is going):
   *     θ_travel = (windDirection + 180) mod 360
   *     W = v * (sin θ_travel, cos θ_travel)   // (east, north)
   *   Street unit vector (A→B):
   *     S = (sin θ_street, cos θ_street)
   *   Headwind = -(W · S)
   *     positive when wind opposes travel, negative when wind assists.
   *   Crosswind = |W × S|  (2D cross product magnitude)
   *
   * The wind speed is first corrected from 10m to street level.
   */
  export function resistance(
    streetBearingDeg: number,
    wind: Wind,
  ): SegmentResistance {
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

  export interface AlongStreet {
  /** Compass direction (deg CW from N) the wind flows along this street segment. */
  angleDeg: number;
  /** Magnitude of wind component along the street, m/s (always ≥ 0). */
  magnitudeMs: number;
}

/**
 * Project wind onto a street's axis.
 *
 * Returns the compass direction the wind is flowing along the street and
 * its scalar magnitude. The crosswind component is discarded.
 *
 * Cyclist interpretation: travelling in the returned `angleDeg` direction
 * yields a tailwind of `magnitudeMs`. Travelling the opposite way along
 * the same street yields a headwind of equal magnitude.
 */
export function alongStreetWind(
  streetBearingDeg: number,
  wind: Wind,
): AlongStreet {
  const v = streetLevelWind(wind.speedMs);
  const thetaTravel = ((wind.directionDeg + 180) % 360) * DEG;
  const Wx = v * Math.sin(thetaTravel);
  const Wy = v * Math.cos(thetaTravel);

  const thetaStreet = streetBearingDeg * DEG;
  const Sx = Math.sin(thetaStreet);
  const Sy = Math.cos(thetaStreet);

  const alongAB = Wx * Sx + Wy * Sy; // signed: positive = A→B, negative = B→A

  if (alongAB >= 0) {
    return { angleDeg: streetBearingDeg, magnitudeMs: alongAB };
  }
  return {
    angleDeg: (streetBearingDeg + 180) % 360,
    magnitudeMs: -alongAB,
  };
}