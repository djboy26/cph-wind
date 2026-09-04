// src/cyclist/bikeTypes.ts
// The bike-type picker's table (PLAN.md step 6). Each type sets baseSpeedMs and
// windSensitivity together, plus its own maxSpeedMs, because effectiveSpeed()
// clamps to maxSpeedMs: the commuter default of 8.5 would cap a road bike's
// tailwind gain at +1.3 m/s, and an EU e-bike's assist cuts at 25 km/h (6.9 m/s),
// so its tailwind gain is small by law, not by aerodynamics. minSpeedMs and
// headwindThresholdMs are the same for every type.
//
// E-bike is its own row for a physical reason: the motor holds speed into a
// headwind, so wind costs battery range rather than legs and windSensitivity
// collapses toward zero.
//
// There is deliberately no rider-weight input. Mass enters only through rolling
// resistance, which is wind-independent, so it cancels out of the extra power a
// headwind costs entirely: a 70 kg and a 110 kg rider both lose 91.9 W to a 5 m/s
// headwind at 18 km/h.

import { DEFAULT_PARAMS, type CyclingParams } from "../routing/windRoute";

export type BikeType = "city" | "commuter" | "road" | "ebike";

export interface BikeTypeSpec {
  key: BikeType;
  label: string;
  /** Calm-air cruising speed, m/s. */
  baseSpeedMs: number;
  /** Speed lost per m/s of headwind. */
  windSensitivity: number;
  /** Ceiling on effective speed, m/s — bounds the tailwind gain. */
  maxSpeedMs: number;
}

export const BIKE_TYPES: readonly BikeTypeSpec[] = [
  { key: "city", label: "City bike", baseSpeedMs: 4.2, windSensitivity: 0.55, maxSpeedMs: 7.0 },
  { key: "commuter", label: "Commuter", baseSpeedMs: 5.0, windSensitivity: 0.5, maxSpeedMs: 8.5 },
  { key: "road", label: "Road bike", baseSpeedMs: 7.2, windSensitivity: 0.42, maxSpeedMs: 11.0 },
  { key: "ebike", label: "E-bike", baseSpeedMs: 6.7, windSensitivity: 0.15, maxSpeedMs: 7.0 },
];

/** Default first, adjust later. Also what an unknown stored value falls back to. */
export const DEFAULT_BIKE: BikeType = "commuter";

export function isBikeType(v: unknown): v is BikeType {
  return typeof v === "string" && BIKE_TYPES.some((b) => b.key === v);
}

export function specFor(key: BikeType): BikeTypeSpec {
  return BIKE_TYPES.find((b) => b.key === key) ?? BIKE_TYPES.find((b) => b.key === DEFAULT_BIKE)!;
}

/** The routing params for a bike type: DEFAULT_PARAMS with the three per-type fields swapped. */
export function paramsFor(key: BikeType): CyclingParams {
  const b = specFor(key);
  return {
    ...DEFAULT_PARAMS,
    baseSpeedMs: b.baseSpeedMs,
    windSensitivity: b.windSensitivity,
    maxSpeedMs: b.maxSpeedMs,
  };
}

/** Cruising speed in whole km/h, for the footer control: 15, 18, 26, 24. */
export function kmhFor(key: BikeType): number {
  return Math.round(specFor(key).baseSpeedMs * 3.6);
}
