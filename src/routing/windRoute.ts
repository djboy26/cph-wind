// src/routing/windRoute.ts
// Wind-aware route comparison. We do NOT pick one optimal route — we generate a
// handful of plausible A→B routes, annotate each with its wind cost, and flag the
// best wind-wise one, leaving every option visible with its numbers.

import { canyonModifiedWind, type CanyonGeometry, type Wind } from '../math';
import { aStar, alternativeRoutes, type RoutePath } from './pathfind';
import type { Edge, RoutingGraph } from './graph';

export interface CyclingParams {
  /** Calm-air cycling speed, m/s (default 5 ≈ 18 km/h). */
  baseSpeedMs: number;
  /** Speed lost per m/s of headwind (gained per m/s of tailwind). */
  windSensitivity: number;
  /** Effective-speed clamps, m/s. */
  minSpeedMs: number;
  maxSpeedMs: number;
  /** Headwind (m/s, street-level) above which a stretch counts as "into the wind". */
  headwindThresholdMs: number;
}

export const DEFAULT_PARAMS: CyclingParams = {
  baseSpeedMs: 5,
  // Speed lost per m/s of headwind. Derived by holding rider power constant in
  //     P = ½·ρ·C_dA·(v + w)²·v + C_rr·m·g·v
  // at 18 km/h with C_dA 0.40 m² and 90 kg (rider + commuter bike, C_rr 0.005):
  // the first m/s of headwind costs 0.52 m/s of ground speed, and the mean cost
  // out to 3 m/s of headwind is ≈0.49. 0.5 sits between the two.
  windSensitivity: 0.5,
  minSpeedMs: 1.2,
  maxSpeedMs: 8.5,
  // A gentle but noticeable headwind. At 2 m/s this almost never triggered on a
  // typical day (street-level wind ≈ 0.6 × ~5 m/s ≈ 3 m/s means you'd have to ride
  // within ~45° of dead into the wind), so "into wind %" read ~0 on every route.
  headwindThresholdMs: 1.0,
};

const DEG = Math.PI / 180;
/** No buildings: λ = 0, so canyonModifiedWind reduces to the flat boundary layer. */
const OPEN: CanyonGeometry = { heightM: 0, widthM: 20 };

/** Signed headwind for travelling along an edge (+ = headwind, − = tailwind), m/s. */
export function edgeHeadwind(edge: Edge, wind: Wind): number {
  // canyonModifiedWind already puts the wind at rider height (the 0.6 applied once, see the
  // note inside it); this must not call resistance(), which would apply it again.
  const w = canyonModifiedWind(edge.bearingDeg, edge.canyon ?? OPEN, wind);
  const travel = ((w.directionDeg + 180) % 360) * DEG;
  const street = edge.bearingDeg * DEG;
  return -(w.speedMs * Math.sin(travel) * Math.sin(street) + w.speedMs * Math.cos(travel) * Math.cos(street));
}

/** Effective cycling speed into a given headwind, m/s (clamped). */
export function effectiveSpeed(headwindMs: number, p: CyclingParams): number {
  const v = p.baseSpeedMs - p.windSensitivity * headwindMs;
  return Math.max(p.minSpeedMs, Math.min(p.maxSpeedMs, v));
}

/** Wind-adjusted travel time for an edge, seconds. */
export function edgeTimeS(edge: Edge, wind: Wind, p: CyclingParams): number {
  return edge.lengthM / effectiveSpeed(edgeHeadwind(edge, wind), p);
}

export interface RouteMetrics {
  distanceM: number;
  /** Wind-adjusted travel time, seconds. */
  timeS: number;
  /** Time if the air were calm, seconds. */
  calmTimeS: number;
  /** Extra (or saved, if negative) seconds due to wind. */
  windDeltaS: number;
  /** Distance-weighted mean headwind, m/s (+ headwind, − tailwind net). */
  avgHeadwindMs: number;
  /** Share of distance ridden into a headwind above threshold, 0..1. */
  headwindExposure: number;
}

export function routeMetrics(route: RoutePath, wind: Wind, p: CyclingParams): RouteMetrics {
  let timeS = 0;
  let headwindDist = 0;
  let exposed = 0;
  const distanceM = route.distanceM;
  for (const e of route.edges) {
    const h = edgeHeadwind(e, wind);
    timeS += e.lengthM / effectiveSpeed(h, p);
    headwindDist += h * e.lengthM;
    if (h > p.headwindThresholdMs) exposed += e.lengthM;
  }
  const calmTimeS = distanceM / p.baseSpeedMs;
  return {
    distanceM,
    timeS,
    calmTimeS,
    windDeltaS: timeS - calmTimeS,
    avgHeadwindMs: distanceM > 0 ? headwindDist / distanceM : 0,
    headwindExposure: distanceM > 0 ? exposed / distanceM : 0,
  };
}

export interface RouteOption {
  id: string;
  /** Where it came from: a distance alternative or the wind-fastest search. */
  kind: 'shortest' | 'alternative' | 'wind-fastest';
  path: RoutePath;
  metrics: RouteMetrics;
  /** [lon, lat] polyline for rendering. */
  coords: [number, number][];
}

function toCoords(g: RoutingGraph, route: RoutePath): [number, number][] {
  return route.nodes.map((n) => [g.nodeLon[n], g.nodeLat[n]]);
}

function edgeSig(route: RoutePath): Set<string> {
  const s = new Set<string>();
  for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1];
    const b = route.nodes[i];
    s.add(a < b ? `${a}-${b}` : `${b}-${a}`);
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

/**
 * Generate, annotate, and rank A→B route options for the given live wind.
 * Returns options sorted by how favourable the wind is (least headwind first);
 * the most wind-favourable is flagged `bestWind`. Each option keeps its full
 * metrics so the rider can trade wind off against distance/time. [] if no path.
 */
export function planRoutes(
  g: RoutingGraph,
  start: number,
  goal: number,
  wind: Wind,
  params: CyclingParams = DEFAULT_PARAMS,
  maxOptions = 4,
): RouteOption[] {
  if (start === goal) return [];

  const candidates: { kind: RouteOption['kind']; path: RoutePath }[] = [];

  // Plausible human routes: shortest distance + diverse alternatives.
  const byDistance = alternativeRoutes(g, start, goal, (e) => e.lengthM, 1, 3);
  byDistance.forEach((p, i) => candidates.push({ kind: i === 0 ? 'shortest' : 'alternative', path: p }));

  // The explicitly wind-optimised route, so the best-wind option is always found.
  const windFast = aStar(g, start, goal, (e) => edgeTimeS(e, wind, params), 1 / params.maxSpeedMs);
  if (windFast) candidates.push({ kind: 'wind-fastest', path: windFast });

  // De-duplicate near-identical paths (keep the first occurrence).
  const sigs: Set<string>[] = [];
  const unique: typeof candidates = [];
  for (const c of candidates) {
    const sig = edgeSig(c.path);
    if (sigs.some((s) => jaccard(s, sig) > 0.85)) continue;
    sigs.push(sig);
    unique.push(c);
  }

  return unique.slice(0, maxOptions).map((c, i) => ({
    id: `route-${i}`,
    kind: c.kind,
    path: c.path,
    metrics: routeMetrics(c.path, wind, params),
    coords: toCoords(g, c.path),
  }));
}

// ---------- Ranking (rider chooses the criterion) ----------

export type RankCriterion = 'recommended' | 'time' | 'exposure' | 'avgWind';

export const RANK_CRITERIA: { key: RankCriterion; label: string; hint: string }[] = [
  { key: 'recommended', label: 'Recommended', hint: 'Balanced time + wind' },
  { key: 'time', label: 'Fastest', hint: 'Shortest wind-adjusted time' },
  { key: 'exposure', label: 'Least headwind', hint: 'Least % ridden into the wind' },
  { key: 'avgWind', label: 'Calmest', hint: 'Lowest average headwind' },
];

/**
 * Below this spread in `windDeltaS` (seconds) across the options, wind is not
 * telling the rider anything useful about which way to go.
 */
const WIND_SIMILAR_SPREAD_S = 15;

function rawValue(o: RouteOption, key: Exclude<RankCriterion, 'recommended'>): number {
  if (key === 'time') return o.metrics.timeS;
  if (key === 'exposure') return o.metrics.headwindExposure;
  return o.metrics.avgHeadwindMs; // avgWind — lower (more tailwind) is better
}

export interface RankResult {
  sorted: RouteOption[];
  bestId: string | null;
  /**
   * True when wind costs every option about the same — the `windDeltaS` spread is
   * under WIND_SIMILAR_SPREAD_S. `recommended` then ranks by distance instead of
   * time, and the UI can say that wind is a wash today.
   */
  windIsSimilar: boolean;
}

/**
 * Sort routes by the chosen criterion (lower is better for all of them) and
 * return the winner's id.
 *
 * `recommended` is an alias of `timeS`. The wind-adjusted time already prices the
 * wind in via `effectiveSpeed()`, so the old weighted blend of `timeS`,
 * `headwindExposure` and `avgHeadwindMs` counted the same wind three times — and
 * because each axis was min-max rescaled to 0..1, 0.3 m/s of wind spread outvoted
 * a minute of time. The one departure is `windIsSimilar`: when wind costs every
 * option the same, distance decides.
 *
 * Every comparator breaks ties on the other axis (time ↔ distance). That is what
 * makes the dominance rule hold: a route longer than another and no better on
 * time or average headwind can never rank first.
 */
export function rankRoutes(options: RouteOption[], criterion: RankCriterion): RankResult {
  if (options.length === 0) return { sorted: [], bestId: null, windIsSimilar: false };

  const deltas = options.map((o) => o.metrics.windDeltaS);
  const windIsSimilar = Math.max(...deltas) - Math.min(...deltas) < WIND_SIMILAR_SPREAD_S;

  let cmp: (a: RouteOption, b: RouteOption) => number;
  if (criterion === 'recommended') {
    cmp = windIsSimilar
      ? (a, b) => a.metrics.distanceM - b.metrics.distanceM || a.metrics.timeS - b.metrics.timeS
      : (a, b) => a.metrics.timeS - b.metrics.timeS || a.metrics.distanceM - b.metrics.distanceM;
  } else {
    cmp = (a, b) =>
      rawValue(a, criterion) - rawValue(b, criterion) || a.metrics.distanceM - b.metrics.distanceM;
  }

  const sorted = [...options].sort(cmp);
  return { sorted, bestId: sorted[0].id, windIsSimilar };
}
