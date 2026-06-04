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
  DEFAULT_PARAMS,
} from './windRoute';
import type { RoutePath } from './pathfind';

// 3×3 lattice near Copenhagen. Rows and columns are LineStrings sharing nodes,
// so the grid is fully connected.
function makeGrid(): FeatureCollection {
  const lon = (i: number) => 12.5 + i * 0.002;
  const lat = (j: number) => 55.68 + j * 0.002;
  const features: any[] = [];
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
  it('returns ranked options with exactly one best-wind flag', () => {
    const opts = planRoutes(G, node(0, 0), node(2, 2), { speedMs: 8, directionDeg: 0 });
    expect(opts.length).toBeGreaterThan(0);
    // sorted ascending by wind-adjusted time
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i].metrics.timeS).toBeGreaterThanOrEqual(opts[i - 1].metrics.timeS);
    }
    expect(opts.filter((o) => o.bestWind).length).toBe(1);
    expect(opts[0].bestWind).toBe(true);
    expect(opts[0].coords[0]).toHaveLength(2); // [lon,lat]
  });

  it('returns [] when start equals goal', () => {
    expect(planRoutes(G, node(1, 1), node(1, 1), { speedMs: 5, directionDeg: 0 })).toEqual([]);
  });
});
