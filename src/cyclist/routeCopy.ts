// src/cyclist/routeCopy.ts
// The words and numbers the route panel says. Kept out of the component so the
// decisions can be unit-tested: anything that chooses a word or a number lives
// here, anything that positions a pixel lives in RoutePanel.tsx.
//
// Every user-facing string in this file is specified in PLAN.md step 4 and is
// reproduced verbatim. Do not paraphrase them — they were written against a
// rendered mockup, and the wording is the part that was tuned.

import type { RouteOption } from "../routing/windRoute";

/** U+2212 MINUS SIGN. A hyphen is narrower and reads as a dash next to digits. */
const MINUS = "−";

/** Below this many seconds either way, wind is not worth a number. */
const NEGLIGIBLE_S = 5;

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

/** The hour bestRideWindow() picked, as a local clock label like "16:00". */
export interface BestWindow {
  at: string;
}

/**
 * The sentence under the route list.
 *
 * Three cases are specified in PLAN.md and are used verbatim:
 *   - wind discriminates    -> "The short way costs you an extra … today. Go round."
 *   - wind is a wash        -> "Wind costs about … whichever way you go today. Take the short one."
 *   - …and a better hour    -> "Wind costs about … whichever way you go. Leave at …
 *                              and it costs nothing."
 *
 * The first sentence presumes the short way is NOT the best way. When the shortest
 * route is also the fastest — or when there is only one route — it would state a
 * number that contradicts the list above it, so those fall back to the calm-day
 * sentence. Decided with the user 2026-09-03; the spec does not cover them.
 *
 * Returns "" when there is nothing to say, which is every state before routes
 * exist. The panel renders no verdict then.
 */
export function verdictFor(
  opts: RouteOption[],
  windIsSimilar: boolean,
  best: BestWindow | null,
): string {
  if (opts.length === 0) return "";

  // opts arrives already ranked, so the first row is the recommendation.
  const recommended = opts[0];
  const shortest = opts.reduce((a, b) => (b.metrics.distanceM < a.metrics.distanceM ? b : a));
  const extraS = shortest.metrics.timeS - recommended.metrics.timeS;

  // Only claim the short way costs time when it actually costs a whole second;
  // below that the sentence would read "an extra 0 s".
  if (!windIsSimilar && opts.length > 1 && extraS >= 1) {
    return `The short way costs you an extra ${durationPhrase(extraS)} today. Go round.`;
  }

  // "whichever way you go" is a claim about the whole set, so the figure is the
  // mean across the options — which windIsSimilar has already held within 15 s.
  // Floored at zero: on a net tailwind the delta goes negative, and the word
  // "costs" is the spec's, not ours, to rewrite.
  const meanDeltaS = opts.reduce((sum, o) => sum + o.metrics.windDeltaS, 0) / opts.length;
  const cost = durationPhrase(Math.max(0, meanDeltaS));

  return best
    ? `Wind costs about ${cost} whichever way you go. Leave at ${best.at} and it costs nothing.`
    : `Wind costs about ${cost} whichever way you go today. Take the short one.`;
}
