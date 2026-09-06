// src/cyclist/bikeTypes.test.ts
import { describe, it, expect } from "vitest";
import { BIKE_TYPES, DEFAULT_BIKE, isBikeType, paramsFor, kmhFor } from "./bikeTypes";
import { DEFAULT_PARAMS } from "../routing/windRoute";

describe("bikeTypes", () => {
  it("every type has a usable speed window: minSpeedMs < baseSpeedMs < maxSpeedMs", () => {
    for (const b of BIKE_TYPES) {
      const p = paramsFor(b.key);
      expect(p.minSpeedMs, b.key).toBeLessThan(p.baseSpeedMs);
      expect(p.baseSpeedMs, b.key).toBeLessThan(p.maxSpeedMs);
    }
  });

  it("the commuter is exactly DEFAULT_PARAMS", () => {
    expect(paramsFor("commuter")).toEqual(DEFAULT_PARAMS);
    expect(DEFAULT_BIKE).toBe("commuter");
  });

  it("only the three per-type fields change; the clamps and threshold are shared", () => {
    for (const b of BIKE_TYPES) {
      const p = paramsFor(b.key);
      expect(p.minSpeedMs).toBe(DEFAULT_PARAMS.minSpeedMs);
      expect(p.headwindThresholdMs).toBe(DEFAULT_PARAMS.headwindThresholdMs);
      expect(p.baseSpeedMs).toBe(b.baseSpeedMs);
      expect(p.windSensitivity).toBe(b.windSensitivity);
      expect(p.maxSpeedMs).toBe(b.maxSpeedMs);
    }
  });

  it("carries the four keys once each, in the spec's order", () => {
    expect(BIKE_TYPES.map((b) => b.key)).toEqual(["city", "commuter", "road", "ebike"]);
  });

  it("guards a stored value: known keys pass, anything else falls back to the default", () => {
    for (const b of BIKE_TYPES) expect(isBikeType(b.key)).toBe(true);
    for (const bad of [null, undefined, "", "tandem", "COMMUTER", 3, {}]) expect(isBikeType(bad)).toBe(false);
  });

  it("labels cruising speed in whole km/h as the table states it", () => {
    expect(kmhFor("city")).toBe(15);
    expect(kmhFor("commuter")).toBe(18);
    expect(kmhFor("road")).toBe(26);
    expect(kmhFor("ebike")).toBe(24);
  });
});
