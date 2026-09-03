// src/cyclist/routeCopy.test.ts
import { describe, it, expect } from "vitest";
import { formatWindDelta, verdictFor, type BestWindow } from "./routeCopy";
import type { RouteOption } from "../routing/windRoute";

/** A route carrying only the three metrics the copy reads. */
function mkRoute(id: string, distanceM: number, timeS: number, windDeltaS: number): RouteOption {
  return {
    id,
    kind: "alternative",
    path: { nodes: [], edges: [], cost: distanceM, distanceM },
    metrics: {
      distanceM,
      timeS,
      calmTimeS: timeS - windDeltaS,
      windDeltaS,
      avgHeadwindMs: 0,
      headwindExposure: 0,
    },
    coords: [],
  };
}

describe("formatWindDelta", () => {
  // The table in PLAN.md step 4, exactly as written.
  it("matches the specified strings", () => {
    expect(formatWindDelta(35)).toBe("+35 s into the wind");
    expect(formatWindDelta(107)).toBe("+1 min 47 s into the wind");
    expect(formatWindDelta(-40)).toBe("−40 s with the wind");
  });

  it("says nothing useful below 5 seconds either way", () => {
    expect(formatWindDelta(0)).toBe("no wind either way");
    expect(formatWindDelta(4)).toBe("no wind either way");
    expect(formatWindDelta(-4)).toBe("no wind either way");
    expect(formatWindDelta(4.9)).toBe("no wind either way");
    expect(formatWindDelta(-4.9)).toBe("no wind either way");
    // 5 is the first value that gets a number.
    expect(formatWindDelta(5)).toBe("+5 s into the wind");
    expect(formatWindDelta(-5)).toBe("−5 s with the wind");
  });

  it("uses a real minus sign, not a hyphen", () => {
    const out = formatWindDelta(-40);
    expect(out.startsWith("−")).toBe(true);
    expect(out).not.toContain("-");
  });

  it("rounds to whole seconds and drops a zero seconds remainder", () => {
    expect(formatWindDelta(35.4)).toBe("+35 s into the wind");
    expect(formatWindDelta(35.6)).toBe("+36 s into the wind");
    expect(formatWindDelta(60)).toBe("+1 min into the wind");
    expect(formatWindDelta(120)).toBe("+2 min into the wind");
    expect(formatWindDelta(61)).toBe("+1 min 1 s into the wind");
    expect(formatWindDelta(-107)).toBe("−1 min 47 s with the wind");
  });

  it("does not throw on a non-finite delta", () => {
    expect(formatWindDelta(NaN)).toBe("no wind either way");
    expect(formatWindDelta(Infinity)).toBe("no wind either way");
  });
});

describe("verdictFor", () => {
  const window: BestWindow = { at: "16:00" };

  it("wind discriminates: names the cost of the short way", () => {
    // Recommended is the longer, faster route; the short way costs 107 s more.
    const opts = [mkRoute("a", 1690, 374, 36), mkRoute("b", 1390, 481, 131)];
    expect(verdictFor(opts, false, null)).toBe(
      "The short way costs you an extra 1 min 47 s today. Go round.",
    );
  });

  it("wind is a wash and no better hour: take the short one", () => {
    const opts = [mkRoute("a", 1390, 323, 35), mkRoute("b", 1690, 380, 35)];
    expect(verdictFor(opts, true, null)).toBe(
      "Wind costs about 35 s whichever way you go today. Take the short one.",
    );
  });

  it("wind is a wash and there is a better hour: name the hour", () => {
    const opts = [mkRoute("a", 1390, 323, 35), mkRoute("b", 1690, 380, 35)];
    expect(verdictFor(opts, true, window)).toBe(
      "Wind costs about 35 s whichever way you go. Leave at 16:00 and it costs nothing.",
    );
  });

  it("averages the wind cost across the options", () => {
    // 30 and 40 -> "about 35 s". windIsSimilar already holds the spread under 15 s.
    const opts = [mkRoute("a", 1390, 323, 30), mkRoute("b", 1690, 380, 40)];
    expect(verdictFor(opts, true, null)).toContain("about 35 s");
  });

  // --- cases the spec does not cover; fallback agreed with the user ---

  it("falls back to the calm sentence when the short way is already the best way", () => {
    // Shortest is also first, so "Go round" would point nowhere.
    const opts = [mkRoute("a", 1390, 323, 35), mkRoute("b", 1690, 400, 35)];
    expect(verdictFor(opts, false, null)).toBe(
      "Wind costs about 35 s whichever way you go today. Take the short one.",
    );
  });

  it("falls back to the calm sentence for a single route", () => {
    const opts = [mkRoute("a", 1390, 323, 35)];
    expect(verdictFor(opts, false, null)).toBe(
      "Wind costs about 35 s whichever way you go today. Take the short one.",
    );
    expect(verdictFor(opts, true, window)).toBe(
      "Wind costs about 35 s whichever way you go. Leave at 16:00 and it costs nothing.",
    );
  });

  it("does not claim the short way costs an extra 0 s", () => {
    // 0.4 s apart: rounds to zero, so the sentence would be untrue.
    const opts = [mkRoute("a", 1690, 374, 36), mkRoute("b", 1390, 374.4, 36)];
    expect(verdictFor(opts, false, null)).not.toContain("Go round");
  });

  it("never prints a negative cost when the wind is a net help", () => {
    const opts = [mkRoute("a", 1390, 300, -20), mkRoute("b", 1690, 360, -18)];
    expect(verdictFor(opts, true, null)).toBe(
      "Wind costs about 0 s whichever way you go today. Take the short one.",
    );
  });

  it("says nothing when there are no routes", () => {
    expect(verdictFor([], false, null)).toBe("");
    expect(verdictFor([], true, window)).toBe("");
  });
});
