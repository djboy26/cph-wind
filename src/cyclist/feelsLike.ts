// src/cyclist/feelsLike.ts
// Apparent temperature ("feels like") for a cyclist. Wind strips heat from exposed
// skin, so on a cold, breezy day it feels markedly colder than the thermometer —
// the deciding factor for how a rider dresses. Uses the standard JAG/TI wind-chill
// formula (Environment Canada / US NWS), valid for T ≤ 10°C and wind ≥ 4.8 km/h.
// Outside that envelope wind chill isn't defined, so we return the air temperature.

const WIND_CHILL_MAX_C = 10;
const WIND_CHILL_MIN_KMH = 4.8;

/** Apparent temperature in °C from air temperature (°C) and wind speed (m/s). */
export function feelsLikeC(tempC: number, windMs: number): number {
  const vKmh = windMs * 3.6;
  if (tempC > WIND_CHILL_MAX_C || vKmh < WIND_CHILL_MIN_KMH) return tempC;
  const v = Math.pow(vKmh, 0.16);
  return 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
}

/** True when wind chill makes it feel at least `deltaC` colder than the air. */
export function feelsColder(tempC: number, windMs: number, deltaC = 3): boolean {
  return tempC - feelsLikeC(tempC, windMs) >= deltaC;
}
