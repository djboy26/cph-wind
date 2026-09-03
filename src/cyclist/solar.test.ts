import { describe, it, expect } from "vitest";
import { sunTimes, isDark } from "./solar";

// Copenhagen city centre.
const LAT = 55.6761;
const LON = 12.5683;

function dayLengthHours(date: Date): number {
  const { sunrise, sunset } = sunTimes(date, LAT, LON);
  if (!sunrise || !sunset) throw new Error("expected sunrise/sunset");
  return (sunset.getTime() - sunrise.getTime()) / 3_600_000;
}

describe("sunTimes", () => {
  it("gives a long day around the summer solstice in Copenhagen", () => {
    const len = dayLengthHours(new Date("2026-06-21T12:00:00Z"));
    expect(len).toBeGreaterThan(16);
    expect(len).toBeLessThan(18.5);
  });

  it("gives a short day around the winter solstice in Copenhagen", () => {
    const len = dayLengthHours(new Date("2026-12-21T12:00:00Z"));
    expect(len).toBeGreaterThan(6);
    expect(len).toBeLessThan(8);
  });

  it("puts sunset after sunrise", () => {
    const { sunrise, sunset } = sunTimes(new Date("2026-03-20T12:00:00Z"), LAT, LON);
    expect(sunrise!.getTime()).toBeLessThan(sunset!.getTime());
  });
});

describe("isDark", () => {
  it("is light at midday and dark in the dead of a winter night", () => {
    expect(isDark(new Date("2026-06-21T12:00:00Z"), LAT, LON)).toBe(false);
    expect(isDark(new Date("2026-12-21T23:00:00Z"), LAT, LON)).toBe(true);
  });
});
