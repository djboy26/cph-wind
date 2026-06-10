// src/cyclist/bestWindow.ts
// The synthesis: scan the next few forecast hours and, IF one is clearly nicer to
// ride in than right now, suggest it ("Best window 16:00 · lighter wind & less
// rain"). Deliberately conservative — it stays quiet unless the gain is real, so
// it nudges rather than nags.

import type { ForecastStep } from "../api/weather";

const HORIZON_HOURS = 6; // only look this far ahead — beyond that "leave later" is moot
const MIN_IMPROVEMENT = 1.2; // discomfort units the best hour must beat "now" by
const WIND_DROP_MS = 1.5; // wind must ease this much to claim "lighter wind"
const RAIN_DROP_MM = 0.3; // rain must ease this much to claim "less rain"

/** A rougher hour scores higher. Rain dominates; gusts add to the felt wind. */
function discomfort(step: ForecastStep): number {
  const gustExtra = step.wind.gustMs ? Math.max(0, step.wind.gustMs - step.wind.speedMs) : 0;
  const wind = step.wind.speedMs + 0.5 * gustExtra;
  const rain = step.conditions.precipMm ?? 0;
  return wind + rain * 4;
}

export interface RideWindow {
  /** Index into the forecast array of the suggested hour. */
  index: number;
  /** Short reason, e.g. "lighter wind & less rain". */
  reason: string;
}

/** The best upcoming hour to ride within the horizon, or null if now is fine. */
export function bestRideWindow(steps: ForecastStep[]): RideWindow | null {
  if (steps.length < 2) return null;
  const now = discomfort(steps[0]);
  let bestIdx = 0;
  let best = now;
  const last = Math.min(HORIZON_HOURS, steps.length - 1);
  for (let i = 1; i <= last; i++) {
    const d = discomfort(steps[i]);
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }
  if (bestIdx === 0 || now - best < MIN_IMPROVEMENT) return null;

  const target = steps[bestIdx];
  const reasons: string[] = [];
  if (steps[0].wind.speedMs - target.wind.speedMs >= WIND_DROP_MS) reasons.push("lighter wind");
  if ((steps[0].conditions.precipMm ?? 0) - (target.conditions.precipMm ?? 0) >= RAIN_DROP_MM) {
    reasons.push("less rain");
  }
  return { index: bestIdx, reason: reasons.join(" & ") || "calmer conditions" };
}
