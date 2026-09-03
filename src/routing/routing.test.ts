// src/routing/routing.test.ts
import { describe, it, expect } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { buildGraph, nearestNode } from './graph';
import { aStar, alternativeRoutes } from './pathfind';
import {
  edgeHeadwind,
  effectiveSpeed,
  routeMetrics,
  planRoutes,
  rankRoutes,
  DEFAULT_PARAMS,
  type RouteOption,
} from './windRoute';
import type { RoutePath } from './pathfind';

// 3×3 lattice near Copenhagen. Rows and columns are LineStrings sharing nodes,
// so the grid is fully connected.
function makeGrid(): FeatureCollection {
  const lon = (i: number) => 12.5 + i * 0.002;
  const lat = (j: number) => 55.68 + j * 0.002;
  const features: FeatureCollection["features"] = [];
  for (let j = 0; j < 3; j++) {
    features.push({
      type: 'Feature',
      properties: { id: `row${j}`, highway: 'residential' },
      geometry: { type: 'LineString', coordinates: [0, 1, 2].map((i) => [lon(i), lat(j)]) },
    });
  }
  for (let i = 0; i < 3; i++) {
    features.push({
      type: 'Feature',
      properties: { id: `col${i}`, highway: 'residential' },
      geometry: { type: 'LineString', coordinates: [0, 1, 2].map((j) => [lon(i), lat(j)]) },
    });
  }
  return { type: 'FeatureCollection', features };
}

const G = buildGraph(makeGrid());
const lon = (i: number) => 12.5 + i * 0.002;
const lat = (j: number) => 55.68 + j * 0.002;
const node = (i: number, j: number) => nearestNode(G, lon(i), lat(j));

describe('buildGraph', () => {
  it('dedups shared nodes into a 9-node lattice', () => {
    expect(G.nodeCount).toBe(9);
  });

  it('is bidirectional with reversed bearings', () => {
    const a = node(0, 0);
    const b = node(1, 0); // due east
    const ab = G.adj[a].find((e) => e.to === b)!;
    const ba = G.adj[b].find((e) => e.to === a)!;
    expect(ab.bearingDeg).toBeCloseTo(90, 0); // east
    expect(ba.bearingDeg).toBeCloseTo(270, 0); // west
    expect(ab.lengthM).toBeCloseTo(ba.lengthM, 6);
  });

  it('excludes non-cyclable highways', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: { id: 'm', highway: 'motorway' },
        geometry: { type: 'LineString', coordinates: [[12.5, 55.68], [12.51, 55.68]] },
      }],
    };
    expect(buildGraph(fc).nodeCount).toBe(0);
  });
});

describe('aStar', () => {
  it('finds the direct path along the bottom row', () => {
    const r = aStar(G, node(0, 0), node(2, 0), (e) => e.lengthM, 1)!;
    expect(r).not.toBeNull();
    expect(r.nodes).toEqual([node(0, 0), node(1, 0), node(2, 0)]);
    expect(r.distanceM).toBeCloseTo(r.cost, 6);
  });

  it('returns null when disconnected', () => {
    const iso = buildGraph({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 'a', highway: 'residential' },
          geometry: { type: 'LineString', coordinates: [[12.5, 55.68], [12.501, 55.68]] } },
        { type: 'Feature', properties: { id: 'b', highway: 'residential' },
          geometry: { type: 'LineString', coordinates: [[12.6, 55.7], [12.601, 55.7]] } },
      ],
    });
    expect(aStar(iso, 0, 3, (e) => e.lengthM, 1)).toBeNull();
  });
});

describe('alternativeRoutes', () => {
  it('returns more than one distinct route across the lattice', () => {
    const routes = alternativeRoutes(G, node(0, 0), node(2, 2), (e) => e.lengthM, 1, 3);
    expect(routes.length).toBeGreaterThan(1);
    // The two routes should not be identical node sequences.
    expect(routes[0].nodes.join()).not.toBe(routes[1].nodes.join());
  });
});

describe('wind cost', () => {
  const northWind = { speedMs: 10, directionDeg: 0 }; // blows from N toward S

  it('headwind is positive riding north, negative riding south', () => {
    const a = node(1, 0);
    const north = G.adj[a].find((e) => e.to === node(1, 1))!; // bearing 0
    const south = G.adj[node(1, 1)].find((e) => e.to === a)!; // bearing 180
    expect(edgeHeadwind(north, northWind)).toBeGreaterThan(0);
    expect(edgeHeadwind(south, northWind)).toBeLessThan(0);
  });

  it('effectiveSpeed slows into headwind, speeds with tailwind, and clamps', () => {
    expect(effectiveSpeed(0, DEFAULT_PARAMS)).toBeCloseTo(5, 5);
    expect(effectiveSpeed(4, DEFAULT_PARAMS)).toBeLessThan(5);
    expect(effectiveSpeed(-4, DEFAULT_PARAMS)).toBeGreaterThan(5);
    expect(effectiveSpeed(100, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.minSpeedMs);
    expect(effectiveSpeed(-100, DEFAULT_PARAMS)).toBe(DEFAULT_PARAMS.maxSpeedMs);
  });

  it('routeMetrics: a northbound leg into a north wind costs extra time', () => {
    const a = node(0, 0);
    const b = node(0, 1);
    const edge = G.adj[a].find((e) => e.to === b)!;
    const route: RoutePath = { nodes: [a, b], edges: [edge], cost: edge.lengthM, distanceM: edge.lengthM };
    const m = routeMetrics(route, northWind, DEFAULT_PARAMS);
    expect(m.avgHeadwindMs).toBeGreaterThan(0);
    expect(m.windDeltaS).toBeGreaterThan(0); // slower than calm
    expect(m.headwindExposure).toBeCloseTo(1, 5);
  });
});

describe('planRoutes', () => {
  it('returns options with metrics and coords', () => {
    const opts = planRoutes(G, node(0, 0), node(2, 2), { speedMs: 8, directionDeg: 0 });
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.metrics.distanceM).toBeGreaterThan(0);
      expect(o.coords[0]).toHaveLength(2); // [lon,lat]
    }
  });

  it('returns [] when start equals goal', () => {
    expect(planRoutes(G, node(1, 1), node(1, 1), { speedMs: 5, directionDeg: 0 })).toEqual([]);
  });
});

describe('rankRoutes', () => {
  const opts = planRoutes(G, node(0, 0), node(2, 2), { speedMs: 8, directionDeg: 0 });

  it('sorts ascending by the chosen criterion and names the winner', () => {
    for (const crit of ['time', 'exposure', 'avgWind'] as const) {
      const { sorted, bestId } = rankRoutes(opts, crit);
      const val = (o: (typeof opts)[number]) =>
        crit === 'time' ? o.metrics.timeS
        : crit === 'exposure' ? o.metrics.headwindExposure
        : o.metrics.avgHeadwindMs;
      for (let i = 1; i < sorted.length; i++) {
        expect(val(sorted[i])).toBeGreaterThanOrEqual(val(sorted[i - 1]));
      }
      expect(bestId).toBe(sorted[0].id);
    }
  });

  it('recommended returns a valid winner over all options', () => {
    const { sorted, bestId } = rankRoutes(opts, 'recommended');
    expect(sorted.length).toBe(opts.length);
    expect(opts.some((o) => o.id === bestId)).toBe(true);
  });

  it('handles an empty option set', () => {
    expect(rankRoutes([], 'time')).toEqual({ sorted: [], bestId: null, windIsSimilar: false });
  });

  // Regression: by exposure, a direct crosswind route must beat a longer detour
  // that dips into a headwind — not the other way round.
  it('by exposure, the crosswind route beats a headwind detour', () => {
    const lon = (i: number) => 12.5 + i * 0.002;
    const lat = (j: number) => 55.68 + j * 0.002;
    const line = (id: string, pts: [number, number][]) => ({
      type: 'Feature' as const,
      properties: { id, highway: 'residential' },
      geometry: { type: 'LineString' as const, coordinates: pts.map(([i, j]) => [lon(i), lat(j)]) },
    });
    // A=(0,0) → B=(0,2). Direct = straight north (crosswind). Detour dips east, up, back west.
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        line('direct', [[0, 0], [0, 1], [0, 2]]),
        line('bottom', [[0, 0], [1, 0]]),
        line('rightcol', [[1, 0], [1, 1], [1, 2]]),
        line('top', [[1, 2], [0, 2]]),
      ],
    };
    const g = buildGraph(fc);
    const A = nearestNode(g, lon(0), lat(0));
    const B = nearestNode(g, lon(0), lat(2));
    // Wind from the east (blows west): north travel is crosswind; the detour's east leg is a headwind.
    const routes = planRoutes(g, A, B, { speedMs: 10, directionDeg: 90 });
    expect(routes.length).toBeGreaterThanOrEqual(2);
    const { sorted, bestId } = rankRoutes(routes, 'exposure');
    const best = sorted.find((o) => o.id === bestId)!;
    for (const o of sorted) {
      expect(best.metrics.headwindExposure).toBeLessThanOrEqual(o.metrics.headwindExposure + 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------
// Step 1 regressions: the ranker must not let trivial wind differences outvote
// real time differences, and must never recommend a strictly dominated route.
// ---------------------------------------------------------------------------

/**
 * A synthetic route carrying a uniform headwind over its whole length. `rankRoutes`
 * reads nothing but `metrics`, so the path and coords are stubs. The metrics are
 * derived through the real `effectiveSpeed()` so `timeS` and `windDeltaS` stay
 * consistent with whatever `DEFAULT_PARAMS` currently says.
 */
function mkRoute(
  id: string,
  distanceM: number,
  avgHeadwindMs: number,
  headwindExposure?: number,
): RouteOption {
  const p = DEFAULT_PARAMS;
  const timeS = distanceM / effectiveSpeed(avgHeadwindMs, p);
  const calmTimeS = distanceM / p.baseSpeedMs;
  return {
    id,
    kind: 'alternative',
    path: { nodes: [], edges: [], cost: distanceM, distanceM },
    metrics: {
      distanceM,
      timeS,
      calmTimeS,
      windDeltaS: timeS - calmTimeS,
      avgHeadwindMs,
      headwindExposure:
        headwindExposure ?? (avgHeadwindMs > p.headwindThresholdMs ? 1 : 0),
    },
    coords: [],
  };
}

describe('rankRoutes — recommended is wind-adjusted time, not a blend', () => {
  // Reproduced against production 2026-09-03, wind 3.1 m/s from 202.5° (SSW).
  // The old weighted blend scored A at 0.450 and picked it, even though A is
  // strictly dominated by C: 80 m longer for identical average headwind.
  // Distances, average headwinds and into-wind exposures are the production values.
  // The exposures matter: they are what let the blend's 0.35 exposure + 0.20 avgWind
  // weights (0.55) outvote its 0.45 on time. Drop them and the old ranker happens to
  // get this case right, so the regression would not be pinned.
  const A = mkRoute('route-A', 1770, 1.1, 0.61);
  const B = mkRoute('route-B', 1390, 1.4, 0.77);
  const C = mkRoute('route-C', 1690, 1.1, 0.71);
  const live = [A, B, C];

  it('picks the short route when wind costs every option the same', () => {
    const { bestId, windIsSimilar } = rankRoutes(live, 'recommended');
    // windDeltaS spread across the three is ~3.5 s, far under the 15 s threshold.
    expect(windIsSimilar).toBe(true);
    expect(bestId).toBe('route-B');
  });

  it('does not pick the dominated route that the old blend picked', () => {
    // Confirm A really is dominated before asserting it loses.
    expect(A.metrics.distanceM).toBeGreaterThan(C.metrics.distanceM);
    expect(A.metrics.avgHeadwindMs).toBeCloseTo(C.metrics.avgHeadwindMs, 12);
    expect(A.metrics.timeS).toBeGreaterThan(C.metrics.timeS);
    expect(rankRoutes(live, 'recommended').bestId).not.toBe('route-A');
  });

  it('still lets a longer route win when wind genuinely discriminates', () => {
    // Strong wind. At the current windSensitivity the long way is ~79 s cheaper.
    const short = mkRoute('route-A', 1390, 4.0);
    const long = mkRoute('route-B', 1690, 1.2);
    const { bestId, windIsSimilar } = rankRoutes([short, long], 'recommended');
    expect(long.metrics.distanceM).toBeGreaterThan(short.metrics.distanceM);
    expect(windIsSimilar).toBe(false);
    expect(bestId).toBe('route-B'); // the fix does not collapse to "always shortest"
  });

  it('flags windIsSimilar from the windDeltaS spread alone', () => {
    const spread = (rs: RouteOption[]) => {
      const d = rs.map((r) => r.metrics.windDeltaS);
      return Math.max(...d) - Math.min(...d);
    };
    expect(spread(live)).toBeLessThan(15);
    expect(rankRoutes(live, 'recommended').windIsSimilar).toBe(true);

    const wide = [mkRoute('a', 1500, 5.0), mkRoute('b', 1500, 0.0)];
    expect(spread(wide)).toBeGreaterThan(15);
    expect(rankRoutes(wide, 'recommended').windIsSimilar).toBe(false);

    // A single option has zero spread, so wind cannot be discriminating.
    expect(rankRoutes([A], 'recommended').windIsSimilar).toBe(true);
  });

  // The dominance rule, asserted directly over randomised inputs: the winner must
  // never be longer than another option while being no better on time or on
  // average headwind. Headwinds run wide enough to exercise the speed clamps.
  it('never ranks a dominated route first, for any input', () => {
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    for (let trial = 0; trial < 500; trial++) {
      const n = 2 + Math.floor(rand() * 4);
      const opts = Array.from({ length: n }, (_, i) =>
        mkRoute(`route-${i}`, 300 + rand() * 4000, -12 + rand() * 24),
      );
      for (const crit of ['recommended', 'time'] as const) {
        const { bestId } = rankRoutes(opts, crit);
        const best = opts.find((o) => o.id === bestId)!;
        for (const o of opts) {
          if (o.id === best.id) continue;
          const dominated =
            best.metrics.distanceM > o.metrics.distanceM &&
            best.metrics.avgHeadwindMs >= o.metrics.avgHeadwindMs &&
            best.metrics.timeS >= o.metrics.timeS;
          expect(dominated).toBe(false);
        }
      }
    }
  });
});
