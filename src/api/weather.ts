// src/api/weather.ts
// MET Norway (yr.no) Locationforecast client for current wind at a given lat/lon.
// No API key required. Chosen over Open-Meteo for reliability (high uptime, stable
// CORS); validated against DMI/METAR observations in scripts/validate-wind.mjs.
//
// Note: browsers forbid setting a custom User-Agent, so the browser's default UA
// is sent. met.no serves `Access-Control-Allow-Origin: *` specifically for browser
// apps, so this works client-side.

import type { Wind } from '../math';

const MET_NO_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

export interface CurrentWindResult {
  wind: Wind;
  /** ISO 8601 timestamp of the forecast step used. */
  timestamp: string;
  source: {
    lat: number;
    lon: number;
    elevationM: number;
  };
}

interface MetNoTimestep {
  time: string;
  data: { instant: { details: Record<string, number> } };
}

export async function fetchCurrentWind(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<CurrentWindResult> {
  // Round coords: met.no requires ≤4 decimals and caches better with fewer.
  const url = `${MET_NO_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  const response = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'cph-wind (https://github.com/djboy26/cph-wind)' },
  });

  if (!response.ok) {
    throw new Error(`MET Norway returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const series: MetNoTimestep[] | undefined = data?.properties?.timeseries;
  if (!series || series.length === 0) {
    throw new Error('MET Norway response missing "timeseries"');
  }

  // Pick the forecast step closest to now (the first step is the current hour).
  const now = Date.now();
  let step = series[0];
  let bestDiff = Infinity;
  for (const s of series) {
    const diff = Math.abs(new Date(s.time).getTime() - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      step = s;
    }
  }

  const d = step.data.instant.details;
  // [lon, lat, altitude_m]
  const coords: number[] = data.geometry?.coordinates ?? [lon, lat, 0];

  return {
    wind: {
      // wind_from_direction is the meteorological "blows FROM" convention,
      // matching Wind.directionDeg.
      speedMs: d.wind_speed,
      directionDeg: d.wind_from_direction,
      gustMs: d.wind_speed_of_gust,
    },
    timestamp: step.time,
    source: {
      lat: coords[1],
      lon: coords[0],
      elevationM: coords[2] ?? 0,
    },
  };
}
