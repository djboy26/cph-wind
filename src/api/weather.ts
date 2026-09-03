// src/api/weather.ts
// Client for current + forecast wind at a given lat/lon. Data comes from MET Norway
// (yr.no) Locationforecast, but we call it through our own `/api/wind` proxy rather
// than api.met.no directly: browsers can't set the User-Agent MET's terms require,
// and the proxy adds a shared cache + rate-limit shielding (see api/wind.ts; in dev
// a Vite proxy stands in — see vite.config.ts). The response shape is MET's, so the
// parsing below is unchanged. Wind model validated against DMI/METAR in
// scripts/validate-wind.mjs.

import type { Wind } from '../math';

const WIND_API_URL = '/api/wind';

/** Non-wind conditions a cyclist also cares about, parsed from the same call. */
export interface Conditions {
  /** Air temperature, °C. */
  tempC?: number;
  /** Relative humidity, %. */
  humidityPct?: number;
  /** Precipitation expected in the next hour, mm. */
  precipMm?: number;
  /** Probability of precipitation next hour, % (absent in the compact product). */
  precipProbPct?: number;
  /** MET symbol code for the next hour, e.g. "rain", "cloudy", "clearsky_day". */
  symbolCode?: string;
}

export interface ForecastStep {
  /** ISO 8601 time of this step. */
  time: string;
  wind: Wind;
  conditions: Conditions;
}

export interface CurrentWindResult {
  wind: Wind;
  /** ISO 8601 timestamp of the forecast step used. */
  timestamp: string;
  /** Conditions for the current step (temperature, rain, …). */
  conditions: Conditions;
  /** Hourly wind from ~now forward (for the time slider). [0] ≈ now. */
  forecast: ForecastStep[];
  source: {
    lat: number;
    lon: number;
    elevationM: number;
  };
}

const FORECAST_STEPS = 24;

interface MetNoTimestep {
  time: string;
  data: {
    instant: { details: Record<string, number> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number> };
  };
}

/** Pull the cyclist-relevant non-wind fields out of one MET timestep. */
function parseConditions(ts: MetNoTimestep): Conditions {
  const inst = ts.data.instant.details;
  const next = ts.data.next_1_hours;
  return {
    tempC: inst.air_temperature,
    humidityPct: inst.relative_humidity,
    precipMm: next?.details?.precipitation_amount,
    precipProbPct: next?.details?.probability_of_precipitation,
    symbolCode: next?.summary?.symbol_code,
  };
}

export async function fetchCurrentWind(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<CurrentWindResult> {
  // Round coords: met.no requires ≤4 decimals and caches better with fewer.
  const url = `${WIND_API_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`Wind service returned ${response.status}: ${await response.text()}`);
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

  // Forecast series: hourly steps from ~now forward (drives the time slider).
  const forecast: ForecastStep[] = [];
  for (const ts of series) {
    if (new Date(ts.time).getTime() < now - 30 * 60 * 1000) continue; // skip past steps
    const dd = ts.data.instant.details;
    if (dd.wind_speed == null || dd.wind_from_direction == null) continue;
    forecast.push({
      time: ts.time,
      wind: { speedMs: dd.wind_speed, directionDeg: dd.wind_from_direction, gustMs: dd.wind_speed_of_gust },
      conditions: parseConditions(ts),
    });
    if (forecast.length >= FORECAST_STEPS) break;
  }

  return {
    wind: {
      // wind_from_direction is the meteorological "blows FROM" convention,
      // matching Wind.directionDeg.
      speedMs: d.wind_speed,
      directionDeg: d.wind_from_direction,
      gustMs: d.wind_speed_of_gust,
    },
    timestamp: step.time,
    conditions: parseConditions(step),
    forecast,
    source: {
      lat: coords[1],
      lon: coords[0],
      elevationM: coords[2] ?? 0,
    },
  };
}
