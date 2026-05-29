// src/api/weather.ts
// Open-Meteo client for current wind at a given lat/lon.
// No API key required. Free tier: 10k req/day.

import type { Wind } from '../math';

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

export interface CurrentWindResult {
  wind: Wind;
  /** ISO 8601 timestamp of the observation. */
  timestamp: string;
  source: {
    lat: number;
    lon: number;
    elevationM: number;
  };
}

export async function fetchCurrentWind(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<CurrentWindResult> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    wind_speed_unit: 'ms',
  });

  const response = await fetch(`${OPEN_METEO_URL}?${params}`, { signal });

  if (!response.ok) {
    throw new Error(
      `Open-Meteo returned ${response.status}: ${await response.text()}`,
    );
  }

  const data = await response.json();

  if (!data.current) {
    throw new Error('Open-Meteo response missing "current" object');
  }

  return {
    wind: {
      speedMs: data.current.wind_speed_10m,
      directionDeg: data.current.wind_direction_10m,
      gustMs: data.current.wind_gusts_10m,
    },
    timestamp: data.current.time,
    source: {
      lat: data.latitude,
      lon: data.longitude,
      elevationM: data.elevation,
    },
  };
}