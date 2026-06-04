// src/routing/windRoute.ts
// Wind-aware route comparison. We do NOT pick one optimal route — we generate a
// handful of plausible A→B routes, annotate each with its wind cost, and flag the
// best wind-wise one, leaving every option visible with its numbers.

import { resistance, type Wind } from '../math';
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
  /** Headwind (m/s) above which a stretch counts as "into the wind". */
  headwindThresholdMs: number;
}

export const DEFAULT_PARAMS: CyclingParams = {
  baseSpeedMs: 5,
  windSensitivity: 0.4,
  minSpeedMs: 1.2,
  maxSpeedMs: 8.5,
  headwindThresholdMs: 2,
};

/** Signed headwind for travelling along an edge (+ = headwind, − = tailwind), m/s. */
export function edgeHeadwind(edge: Edge, wind: Wind): number {
  return resistance(edge.bearingDeg, wind).headwindMs;
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
  /** True for the route with the lowest wind-adjusted time. */
  bestWind: boolean;
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

  const options: RouteOption[] = unique.slice(0, maxOptions).map((c, i) => ({
    id: `route-${i}`,
    kind: c.kind,
    path: c.path,
    metrics: routeMetrics(c.path, wind, params),
    coords: toCoords(g, c.path),
    bestWind: false,
  }));

  // "Best for wind" = the route the wind treats best: the smallest wind time
  // penalty (windDeltaS = time the wind costs(+)/saves(−)), independent of route
  // length. Crosswind contributes ~0, headwind costs, tailwind saves — so this is
  // not foolable by detours and matches the "saves/costs X min" shown per route.
  // (Ranking by total wind-adjusted TIME instead would just pick the shortest
  // route, since distance dominates — that is NOT "best wind-wise".)
  options.sort((a, b) => a.metrics.windDeltaS - b.metrics.windDeltaS);
  if (options.length > 0) options[0].bestWind = true;
  return options;
}
