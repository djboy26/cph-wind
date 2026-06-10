// src/cyclist/solar.ts
// Local sunrise/sunset for a given date + location — no network, works offline.
// Standard low-precision solar algorithm (after Vladimir Agafonkin's SunCalc),
// accurate to ~1 minute, which is plenty for a "do I need lights?" indicator.
//
// Why local instead of MET's Sunrise API: it's a pure function of date + lat/lon,
// so we avoid an extra request, it works with no signal, and it can be unit-tested.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397; // axial tilt of the Earth
// Sun's centre 0.833° below the horizon = rim touching, with mean refraction.
const H0 = -0.833 * RAD;

const toDays = (date: Date) => date.getTime() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M: number) {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = RAD * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}
const declination = (L: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));

const J0 = 0.0009;
const julianCycle = (d: number, lw: number) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) =>
  J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, dec: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  /** Sun never sets (high-summer polar latitudes). */
  alwaysUp: boolean;
  /** Sun never rises (deep-winter polar latitudes). */
  alwaysDown: boolean;
}

/** Sunrise and sunset for the civil day containing `date`, at the given location. */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const cosH = (Math.sin(H0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH < -1) return { sunrise: null, sunset: null, alwaysUp: true, alwaysDown: false };
  if (cosH > 1) return { sunrise: null, sunset: null, alwaysUp: false, alwaysDown: true };

  const w = hourAngle(H0, phi, dec);
  const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset), alwaysUp: false, alwaysDown: false };
}

/**
 * Is it dark (sun below the horizon) at this instant at the given location?
 * Used to flag forecast hours that need bike lights.
 */
export function isDark(at: Date, lat: number, lon: number): boolean {
  const { sunrise, sunset, alwaysUp, alwaysDown } = sunTimes(at, lat, lon);
  if (alwaysUp) return false;
  if (alwaysDown) return true;
  if (!sunrise || !sunset) return false;
  const t = at.getTime();
  return t < sunrise.getTime() || t > sunset.getTime();
}
