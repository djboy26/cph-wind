import { describe, it, expect } from "vitest";
import { cyclingAdvisory } from "./advisory";
import type { Wind } from "../math";

const wind = (speedMs: number, gustMs?: number): Wind => ({ speedMs, directionDeg: 200, gustMs });

describe("cyclingAdvisory", () => {
  it("returns nothing on a calm, mild day", () => {
    expect(cyclingAdvisory(wind(3, 4), { tempC: 18, precipMm: 0, humidityPct: 60 })).toBeNull();
  });

  it("returns nothing when there is no wind data", () => {
    expect(cyclingAdvisory(null, { tempC: 18 })).toBeNull();
  });

  it("warns about ice when near-freezing and damp", () => {
    const a = cyclingAdvisory(wind(3), { tempC: 1, humidityPct: 95 });
    expect(a?.level).toBe("warn");
    expect(a?.text.toLowerCase()).toContain("ic");
  });

  it("warns about severe sustained wind", () => {
    const a = cyclingAdvisory(wind(13, 15), { tempC: 8 });
    expect(a?.level).toBe("warn");
    expect(a?.text).toContain("Severe");
  });

  it("cautions about punchy gusts", () => {
    const a = cyclingAdvisory(wind(5, 11), { tempC: 8 });
    expect(a?.level).toBe("caution");
    expect(a?.text).toContain("Gusting");
  });

  it("mentions heavy rain", () => {
    const a = cyclingAdvisory(wind(3, 4), { tempC: 10, precipMm: 3 });
    expect(a?.level).toBe("info");
    expect(a?.text).toContain("Rain");
  });

  it("prioritises ice over gusts", () => {
    const a = cyclingAdvisory(wind(4, 15), { tempC: 1, humidityPct: 95 });
    expect(a?.text.toLowerCase()).toContain("ic");
  });
});
