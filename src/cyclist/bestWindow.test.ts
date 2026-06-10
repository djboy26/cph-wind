import { describe, it, expect } from "vitest";
import { bestRideWindow } from "./bestWindow";
import type { ForecastStep } from "../api/weather";

const step = (speedMs: number, precipMm = 0): ForecastStep => ({
  time: new Date().toISOString(),
  wind: { speedMs, directionDeg: 200 },
  conditions: { precipMm },
});

describe("bestRideWindow", () => {
  it("returns null with too few steps", () => {
    expect(bestRideWindow([step(5)])).toBeNull();
  });

  it("returns null when conditions are flat", () => {
    expect(bestRideWindow([step(5), step(5), step(5), step(5)])).toBeNull();
  });

  it("suggests a clearly calmer upcoming hour and names the reason", () => {
    const w = bestRideWindow([step(8), step(7), step(3), step(4)]);
    expect(w?.index).toBe(2);
    expect(w?.reason).toContain("lighter wind");
  });

  it("notices when rain stops later", () => {
    const w = bestRideWindow([step(5, 2), step(5, 2), step(5, 0)]);
    expect(w?.index).toBe(2);
    expect(w?.reason).toContain("less rain");
  });

  it("stays quiet when now is already the best", () => {
    expect(bestRideWindow([step(3), step(6), step(7)])).toBeNull();
  });
});
