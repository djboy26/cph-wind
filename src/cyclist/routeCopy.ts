// src/cyclist/routeCopy.ts
// The words and numbers the route panel says. Kept out of the component so the
// decisions can be unit-tested: anything that chooses a word or a number lives
// here, anything that positions a pixel lives in RoutePanel.tsx.
//
// Every user-facing string in this file is specified in PLAN.md steps 4 and 4c and
// is reproduced verbatim. Do not paraphrase them — they were written against a
// rendered mockup, and the wording is the part that was tuned.

import type { RouteOption } from "../routing/windRoute";

/** U+2212 MINUS SIGN. A hyphen is narrower and reads as a dash next to digits. */
const MINUS = "−";

/** Below this many seconds either way, wind is not worth a number. */
const NEGLIGIBLE_S = 5;

/** A later hour must beat today's mean cost by this much before it is worth a number. */
const WORTH_MENTIONING_S = 10;

/**
 * A bare duration: "35 s", "1 min 47 s", "2 min". Sign-free — callers add the
 * sign and the wording around it.
 */
function durationPhrase(seconds: number): string {
  const total = Math.round(Math.abs(seconds));
  if (total < 60) return `${total} s`;
  const min = Math.floor(total / 60);
  const rem = total % 60;
  return rem === 0 ? `${min} min` : `${min} min ${rem} s`;
}

/**
 * The wind figure under each route time.
 *
 *   +35   ->  "+35 s into the wind"
 *   +107  ->  "+1 min 47 s into the wind"
 *   -40   ->  "−40 s with the wind"
 *   |x|<5 ->  "no wind either way"
 */
export function formatWindDelta(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) < NEGLIGIBLE_S) return "no wind either way";
  return seconds > 0
    ? `+${durationPhrase(seconds)} into the wind`
    : `${MINUS}${durationPhrase(seconds)} with the wind`;
}

/** Same clock format the TimeSlider uses: "16:00". */
function clockLabel(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * "Times below use the 16:00 forecast." — the hour the route times were computed
 * for, once the rider has scrubbed the TimeSlider away from "Now".
 *
 * Whether they scrubbed is App's question (forecastIdx > 0), not this function's:
 * comparing clock hours fired on "Now" from :30 onward, because fetchCurrentWind
 * drops any step older than 30 minutes and forecast[0] becomes the next hour.
 * This only formats. Null for no selection or an invalid date.
 */
export function forecastNote(selectedHour: Date | null): string | null {
  if (!selectedHour || Number.isNaN(selectedHour.getTime())) return null;
  return `Times below use the ${clockLabel(selectedHour)} forecast.`;
}

/** The hour bestRideWindow() picked, re-priced for the recommended route. */
export interface BestWindow {
  /** Local clock label, "16:00". */
  at: string;
  /** windDeltaS of the recommended route computed with that hour's wind, seconds. */
  deltaS: number;
}

/**
 * The "Leave at …" clause, or null when the later hour is not worth naming.
 *
 * bestRideWindow() scores wind AND rain, so it can fire on "less rain" with the
 * wind unchanged or worse. The clause therefore only ever speaks from the route's
 * re-priced cost at that hour, never from the window alone.
 */
function leaveAtClause(meanS: number, best: BestWindow | null): string | null {
  if (!best || !Number.isFinite(best.deltaS)) return null;
  if (best.deltaS < NEGLIGIBLE_S) return `Leave at ${best.at} and it costs nothing.`;
  if (meanS - best.deltaS >= WORTH_MENTIONING_S) {
    return `Leave at ${best.at} and it costs about ${durationPhrase(best.deltaS)}.`;
  }
  return null;
}

/**
 * The sentence under the route list. The decision table from PLAN.md step 4c;
 * rows are precedence, so a tailwind day where a detour is still faster gets
 * "Go round" (B) rather than "the wind is with you" (E).
 *
 *   A  no routes                                   ""
 *   B  wind discriminates, short way costs ≥ 1 s   The short way costs you an extra … today. Go round.
 *   C  wind discriminates, short way still fastest  The short way is still the fastest today.
 *   D  wind is a wash, net headwind                 Wind costs about … whichever way you go today. Take the short one.
 *   E  net tailwind, any spread                     The wind is with you today. Take the short one.
 *   F  nothing to speak of either way               No wind to speak of today. Take the short one.
 *
 * The "Leave at" clause attaches to C and D only — the two headwind rows. For D it
 * replaces "today. Take the short one."; for C it is appended.
 *
 * `opts` must be the RECOMMENDED order, rankRoutes(options, 'recommended').sorted,
 * whatever the panel is currently sorted by. The verdict is a statement about the
 * day, not about the sort: with "Sort by wind" on, the displayed first row is the
 * least-windy route, and comparing the shortest route against that can land on the
 * calm-day sentence on a windy day.
 */
export function verdictFor(
  opts: RouteOption[],
  windIsSimilar: boolean,
  best: BestWindow | null,
): string {
  if (opts.length === 0) return ""; // A

  const rec = opts[0];
  const shortest = opts.reduce((a, b) => (b.metrics.distanceM < a.metrics.distanceM ? b : a));
  const extraS = shortest.metrics.timeS - rec.metrics.timeS;
  const mean = opts.reduce((sum, o) => sum + o.metrics.windDeltaS, 0) / opts.length;

  // B — only when the short way costs a whole second; below that it would read
  // "an extra 0 s", and the short way is, to the rider, the fastest.
  if (!windIsSimilar && opts.length > 1 && extraS >= 1) {
    return `The short way costs you an extra ${durationPhrase(extraS)} today. Go round.`;
  }

  if (mean > NEGLIGIBLE_S) {
    const clause = leaveAtClause(mean, best);
    if (windIsSimilar) {
      // D
      return clause
        ? `Wind costs about ${durationPhrase(mean)} whichever way you go. ${clause}`
        : `Wind costs about ${durationPhrase(mean)} whichever way you go today. Take the short one.`;
    }
    // C
    const sentence = "The short way is still the fastest today.";
    return clause ? `${sentence} ${clause}` : sentence;
  }

  if (mean < -NEGLIGIBLE_S) return "The wind is with you today. Take the short one."; // E
  return "No wind to speak of today. Take the short one."; // F
}
