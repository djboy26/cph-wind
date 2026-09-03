// src/cyclist/advisory.ts
// Turns the current conditions into at most ONE short safety advisory for the rider.
// Ranked by severity; returns null when there's nothing worth saying (the common
// case), so the UI chip stays hidden and the screen uncluttered.

import type { Wind } from "../math";
import type { Conditions } from "../api/weather";
import type { IconName } from "../components/Icon";

export type AdvisoryLevel = "warn" | "caution" | "info";

export interface Advisory {
  level: AdvisoryLevel;
  icon: IconName;
  text: string;
}

const ICE_TEMP_C = 3; // at/below this, with moisture, surfaces can ice over
const ICE_HUMIDITY_PCT = 90;
const SEVERE_WIND_MS = 12;
const GUST_ABSOLUTE_MS = 12;
const GUST_OVER_MEAN_MS = 5; // gusts this much above the mean = noticeably punchy
const HEAVY_RAIN_MM = 2;
const HOT_C = 27; // warm enough that a Copenhagen rider should carry water

/** Highest-priority advisory for the given wind + conditions, or null if none. */
export function cyclingAdvisory(wind: Wind | null, cond: Conditions | null): Advisory | null {
  if (!wind) return null;
  const gust = wind.gustMs ?? 0;
  const temp = cond?.tempC;
  const precip = cond?.precipMm ?? 0;
  const humidity = cond?.humidityPct ?? 0;

  // 1. Ice: the most dangerous, easy to forget on a clear looking morning.
  if (temp != null && temp <= ICE_TEMP_C && (precip > 0 || humidity >= ICE_HUMIDITY_PCT)) {
    return { level: "warn", icon: "alert", text: "Close to freezing and damp. Watch for icy patches." };
  }
  // 2. Severe sustained wind.
  if (wind.speedMs >= SEVERE_WIND_MS) {
    return {
      level: "warn",
      icon: "alert",
      text: `Severe wind (${Math.round(wind.speedMs)} m/s). Exposed stretches will be tough.`,
    };
  }
  // 3. Strong or punchy gusts (you can be calm one second, shoved the next).
  if (gust >= GUST_ABSOLUTE_MS || gust - wind.speedMs >= GUST_OVER_MEAN_MS) {
    return {
      level: "caution",
      icon: "wind",
      text: `Gusting to ${Math.round(gust)} m/s. Take care on bridges and open stretches.`,
    };
  }
  // 4. Heavy rain right now.
  if (precip >= HEAVY_RAIN_MM) {
    return { level: "info", icon: "rain", text: `Rain now (${precip.toFixed(1)} mm/h). Mind wet brakes.` };
  }
  // 5. Hot day: comfort and hydration.
  if (temp != null && temp >= HOT_C) {
    return { level: "info", icon: "sun", text: `Warm ride (${Math.round(temp)}°). Carry water and take it easy.` };
  }
  return null;
}
