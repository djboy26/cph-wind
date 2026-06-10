import { describe, it, expect } from "vitest";
import { feelsLikeC, feelsColder } from "./feelsLike";

describe("feelsLikeC", () => {
  it("returns the air temperature when it's mild (no wind chill above 10°C)", () => {
    expect(feelsLikeC(20, 5)).toBe(20);
    expect(feelsLikeC(11, 8)).toBe(11);
  });

  it("returns the air temperature when the wind is too light to chill", () => {
    expect(feelsLikeC(5, 0.5)).toBe(5);
  });

  it("feels colder than the air on a cold, windy day", () => {
    const fl = feelsLikeC(0, 10);
    expect(fl).toBeLessThan(0);
    expect(fl).toBeCloseTo(-7, 0);
  });

  it("flags a meaningful chill", () => {
    expect(feelsColder(0, 10)).toBe(true);
    expect(feelsColder(20, 5)).toBe(false);
  });
});
