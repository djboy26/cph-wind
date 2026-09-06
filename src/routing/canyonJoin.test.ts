import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { FeatureCollection } from 'geojson';
import { buildGraph, type CanyonByWay } from './graph';
import { edgeHeadwind } from './windRoute';
import { resistance } from '../math';

// A straight 90 m way heading north from (12.5683, 55.6761): three 30 m pieces.
const LAT_PER_M = 1 / 111_000;
const way = (id: number, n: number, stepM: number): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { id, highway: 'residential' },
    geometry: { type: 'LineString', coordinates: Array.from({ length: n + 1 }, (_, i) => [12.5683, 55.6761 + i * stepM * LAT_PER_M]) },
  }],
});

describe('canyon join', () => {
  it('attaches the piece under each edge midpoint', () => {
    const table: CanyonByWay = { '7': [[0, 5, 10], [30, 20, 10], [60, 5, 10]] };
    const g = buildGraph(way(7, 3, 30), table);
    expect(g.canyonEdges).toBe(6);
    const lambdas = g.adj[0].map((e) => e.canyon!.heightM / e.canyon!.widthM);
    expect(lambdas).toEqual([0.5]);
    expect(g.adj[1].map((e) => e.canyon!.heightM / e.canyon!.widthM).sort()).toEqual([0.5, 2]);
    expect(g.adj[3][0].canyon).toEqual({ heightM: 5, widthM: 10 });
  });

  it('a way absent from the table routes on the flat model exactly', () => {
    const g = buildGraph(way(8, 3, 30), {});
    expect(g.canyonEdges).toBe(0);
    const e = g.adj[0][0];
    expect(e.canyon).toBeUndefined();
    for (const dir of [0, 45, 90, 225]) {
      const wind = { speedMs: 5, directionDeg: dir };
      expect(edgeHeadwind(e, wind)).toBeCloseTo(resistance(e.bearingDeg, wind).headwindMs, 9);
    }
  });

  it('λ = 1 heading north, wind from the north: 5 × 0.6 × 1.3', () => {
    const g = buildGraph(way(9, 1, 30), { '9': [[0, 10, 10]] });
    const fwd = g.adj[0][0]; // 0 → 1, north
    const back = g.adj[1][0];
    expect(edgeHeadwind(fwd, { speedMs: 5, directionDeg: 0 })).toBeCloseTo(3.9, 9);
    expect(edgeHeadwind(back, { speedMs: 5, directionDeg: 0 })).toBeCloseTo(-3.9, 9);
  });

  it('a cross wind projects to nothing whatever the canyon does to it', () => {
    const g = buildGraph(way(9, 1, 30), { '9': [[0, 10, 10]] });
    expect(edgeHeadwind(g.adj[0][0], { speedMs: 5, directionDeg: 90 })).toBeCloseTo(0, 9);
  });

  it('the committed table parses, is large, and is sorted', () => {
    const table = JSON.parse(readFileSync('public/data/canyon-by-way.json', 'utf8')) as CanyonByWay;
    const keys = Object.keys(table);
    expect(keys.length).toBeGreaterThan(30_000);
    for (const k of keys) {
      const rows = table[k];
      for (let i = 1; i < rows.length; i++) expect(rows[i][0]).toBeGreaterThan(rows[i - 1][0]);
    }
  });
});
