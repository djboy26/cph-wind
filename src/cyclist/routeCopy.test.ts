// src/cyclist/routeCopy.test.ts
import { describe, it, expect } from "vitest";
import { formatWindDelta, verdictFor, forecastNote, type BestWindow } from "./routeCopy";
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

// The step 4c decision table, one case per row, then one per clause outcome.
// Every fixture is the RECOMMENDED order: opts[0] is the recommendation.
describe("verdictFor — rows A to F", () => {
  it("A: says nothing when there are no routes", () => {
    expect(verdictFor([], false, null)).toBe("");
    expect(verdictFor([], true, { at: "16:00", deltaS: 0 })).toBe("");
  });

  it("B: wind discriminates and the short way costs time: go round", () => {
    // Recommended is the longer, faster route; the short way costs 107 s more.
    const opts = [mkRoute("a", 1690, 374, 36), mkRoute("b", 1390, 481, 131)];
    expect(verdictFor(opts, false, null)).toBe(
      "The short way costs you an extra 1 min 47 s today. Go round.",
    );
  });

  it("B beats E: a tailwind day where the detour is still faster says go round", () => {
    // Both routes save time, but the long way saves 100 s more.
    const opts = [mkRoute("a", 1690, 300, -60), mkRoute("b", 1390, 400, -50)];
    expect(verdictFor(opts, false, null)).toBe(
      "The short way costs you an extra 1 min 40 s today. Go round.",
    );
  });

  it("C: wind discriminates but the short way is still the fastest", () => {
    // Shortest is also the recommendation, so there is nothing to go round.
    const opts = [mkRoute("a", 1390, 323, 40), mkRoute("b", 1690, 420, 30)];
    expect(verdictFor(opts, false, null)).toBe("The short way is still the fastest today.");
  });

  it("C: a sub-second gap is not a reason to go round", () => {
    // 0.4 s apart rounds to zero, so B would read "an extra 0 s".
    const opts = [mkRoute("a", 1690, 374, 36), mkRoute("b", 1390, 374.4, 36)];
    expect(verdictFor(opts, false, null)).toBe("The short way is still the fastest today.");
  });

  it("D: wind is a wash: costs about the mean, take the short one", () => {
    // 30 and 40 -> "about 35 s".
    const opts = [mkRoute("a", 1390, 323, 30), mkRoute("b", 1690, 380, 40)];
    expect(verdictFor(opts, true, null)).toBe(
      "Wind costs about 35 s whichever way you go today. Take the short one.",
    );
  });

  it("E: net tailwind: the wind is with you, whatever the spread", () => {
    // Similar wind, both saving time.
    expect(verdictFor([mkRoute("a", 1390, 300, -20), mkRoute("b", 1690, 360, -18)], true, null)).toBe(
      "The wind is with you today. Take the short one.",
    );
    // Very different wind, short way already fastest, so B does not apply.
    expect(verdictFor([mkRoute("a", 1390, 300, -60), mkRoute("b", 1690, 400, -20)], false, null)).toBe(
      "The wind is with you today. Take the short one.",
    );
    // A single route on a tailwind day.
    expect(verdictFor([mkRoute("a", 1390, 300, -20)], true, null)).toBe(
      "The wind is with you today. Take the short one.",
    );
  });

  it("F: nothing to speak of either way", () => {
    expect(verdictFor([mkRoute("a", 1390, 323, 2), mkRoute("b", 1690, 380, -3)], true, null)).toBe(
      "No wind to speak of today. Take the short one.",
    );
    // The boundary is inclusive both ways: ±5 s is still "no wind".
    expect(verdictFor([mkRoute("a", 1390, 323, 5), mkRoute("b", 1690, 380, 5)], true, null)).toBe(
      "No wind to speak of today. Take the short one.",
    );
    expect(verdictFor([mkRoute("a", 1390, 323, -5), mkRoute("b", 1690, 380, -5)], false, null)).toBe(
      "No wind to speak of today. Take the short one.",
    );
    // Just over the line is a headwind.
    expect(verdictFor([mkRoute("a", 1390, 323, 5.5), mkRoute("b", 1690, 380, 5.5)], true, null)).toContain(
      "Wind costs about",
    );
  });

  it("never says the wind costs a negative or zero amount", () => {
    for (const similar of [true, false]) {
      for (const [d1, d2] of [[-20, -18], [-60, -20], [0, 0], [3, -3]]) {
        const out = verdictFor([mkRoute("a", 1390, 300, d1), mkRoute("b", 1690, 360, d2)], similar, null);
        expect(out).not.toContain("costs about");
      }
    }
  });
});

describe("verdictFor — the Leave at clause", () => {
  const at = "16:00";
  // D fixture: a wash at a mean of 47 s.
  const wash47 = [mkRoute("a", 1390, 323, 45), mkRoute("b", 1690, 380, 49)];
  // C fixture: wind discriminates, short way already fastest, mean 47 s.
  const stillFastest47 = [mkRoute("a", 1390, 323, 60), mkRoute("b", 1690, 420, 34)];

  it("costs nothing: the later hour is under 5 s, replacing D's tail", () => {
    expect(verdictFor(wash47, true, { at, deltaS: 2 })).toBe(
      "Wind costs about 47 s whichever way you go. Leave at 16:00 and it costs nothing.",
    );
    expect(verdictFor(wash47, true, { at, deltaS: -30 })).toContain("costs nothing");
  });

  it("costs about: the later hour is at least 10 s better, replacing D's tail", () => {
    expect(verdictFor(wash47, true, { at, deltaS: 12 })).toBe(
      "Wind costs about 47 s whichever way you go. Leave at 16:00 and it costs about 12 s.",
    );
    // Exactly 5 s is not "nothing"; 47 − 5 clears the 10 s bar, so it is named.
    expect(verdictFor(wash47, true, { at, deltaS: 5 })).toBe(
      "Wind costs about 47 s whichever way you go. Leave at 16:00 and it costs about 5 s.",
    );
  });

  it("no clause: the gain is under 10 s, or the later hour is worse", () => {
    const plain = "Wind costs about 47 s whichever way you go today. Take the short one.";
    expect(verdictFor(wash47, true, { at, deltaS: 40 })).toBe(plain); // 7 s better
    expect(verdictFor(wash47, true, { at, deltaS: 47 })).toBe(plain); // no better
    expect(verdictFor(wash47, true, { at, deltaS: 90 })).toBe(plain); // worse
    expect(verdictFor(wash47, true, { at, deltaS: NaN })).toBe(plain);
  });

  it("appends to C rather than replacing it", () => {
    expect(verdictFor(stillFastest47, false, { at, deltaS: 2 })).toBe(
      "The short way is still the fastest today. Leave at 16:00 and it costs nothing.",
    );
    expect(verdictFor(stillFastest47, false, { at, deltaS: 12 })).toBe(
      "The short way is still the fastest today. Leave at 16:00 and it costs about 12 s.",
    );
    expect(verdictFor(stillFastest47, false, { at, deltaS: 45 })).toBe(
      "The short way is still the fastest today.",
    );
  });

  it("never attaches to B, E or F", () => {
    const window: BestWindow = { at, deltaS: 0 };
    const b = verdictFor([mkRoute("a", 1690, 374, 36), mkRoute("b", 1390, 481, 131)], false, window);
    const e = verdictFor([mkRoute("a", 1390, 300, -20), mkRoute("b", 1690, 360, -18)], true, window);
    const f = verdictFor([mkRoute("a", 1390, 323, 2), mkRoute("b", 1690, 380, -3)], true, window);
    for (const out of [b, e, f]) expect(out).not.toContain("Leave at");
  });
});

describe("forecastNote", () => {
  // Whether the rider scrubbed (forecastIdx > 0) is decided in App.tsx, which has
  // no test harness. This function only formats.
  it("names the hour the times were computed for", () => {
    expect(forecastNote(new Date(2026, 8, 3, 16, 0))).toBe("Times below use the 16:00 forecast.");
  });

  it("pads to HH:mm", () => {
    expect(forecastNote(new Date(2026, 8, 3, 9, 5))).toBe("Times below use the 09:05 forecast.");
  });

  it("returns null when there is no selected hour", () => {
    expect(forecastNote(null)).toBeNull();
  });

  it("returns null on an invalid date", () => {
    expect(forecastNote(new Date("nonsense"))).toBeNull();
  });
});
