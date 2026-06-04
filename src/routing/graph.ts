// src/routing/graph.ts
// Builds a routable cycling graph from the road GeoJSON. Ways are split at every
// vertex into directed edges; edges that share a coordinate connect into a graph.
// Each directed edge carries its own travel bearing, so A→B and B→A correctly get
// opposite head/tailwind.

import type { FeatureCollection } from 'geojson';
import { bearing, type LonLat } from '../math';

const MPER_DEG_LAT = 111_000;
const DEG = Math.PI / 180;

// Highway classes a bike cannot (or should not) use.
const EXCLUDED = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction']);

export interface Edge {
  /** Destination node index. */
  to: number;
  lengthM: number;
  /** Travel bearing for this directed edge, deg CW from north. */
  bearingDeg: number;
  wayId: string | number | undefined;
  highway: string;
}

export interface RoutingGraph {
  nodeLon: Float64Array;
  nodeLat: Float64Array;
  nodeCount: number;
  /** adj[nodeIndex] = outgoing directed edges. */
  adj: Edge[][];
  edgeCount: number;
}

function metersBetween(a: LonLat, b: LonLat): number {
  const mLat = ((a.lat + b.lat) / 2) * DEG;
  const dx = (b.lon - a.lon) * MPER_DEG_LAT * Math.cos(mLat);
  const dy = (b.lat - a.lat) * MPER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

export function buildGraph(roads: FeatureCollection): RoutingGraph {
  const idOf = new Map<string, number>();
  const lons: number[] = [];
  const lats: number[] = [];

  const nodeId = (lon: number, lat: number): number => {
    const key = `${lon.toFixed(6)},${lat.toFixed(6)}`;
    let id = idOf.get(key);
    if (id === undefined) {
      id = lons.length;
      idOf.set(key, id);
      lons.push(lon);
      lats.push(lat);
    }
    return id;
  };

  const adj: Edge[][] = [];
  const ensure = (id: number) => {
    while (adj.length <= id) adj.push([]);
  };

  let edgeCount = 0;
  for (const f of roads.features) {
    if (!f.geometry || f.geometry.type !== 'LineString') continue;
    const highway = (f.properties?.highway as string) || 'unclassified';
    if (EXCLUDED.has(highway)) continue;
    const wayId = f.properties?.id as string | number | undefined;
    const coords = f.geometry.coordinates as [number, number][];

    for (let i = 0; i < coords.length - 1; i++) {
      const [lonA, latA] = coords[i];
      const [lonB, latB] = coords[i + 1];
      if (lonA === lonB && latA === latB) continue;
      const a = nodeId(lonA, latA);
      const b = nodeId(lonB, latB);
      ensure(a);
      ensure(b);
      const A = { lon: lonA, lat: latA };
      const B = { lon: lonB, lat: latB };
      const lengthM = metersBetween(A, B);
      const fwd = bearing(A, B);
      adj[a].push({ to: b, lengthM, bearingDeg: fwd, wayId, highway });
      adj[b].push({ to: a, lengthM, bearingDeg: (fwd + 180) % 360, wayId, highway });
      edgeCount += 2;
    }
  }

  while (adj.length < lons.length) adj.push([]);

  return {
    nodeLon: Float64Array.from(lons),
    nodeLat: Float64Array.from(lats),
    nodeCount: lons.length,
    adj,
    edgeCount,
  };
}

/** Nearest graph node to a lon/lat (linear scan; fine for occasional clicks). */
export function nearestNode(g: RoutingGraph, lon: number, lat: number): number {
  let best = -1;
  let bestD = Infinity;
  const mLat = lat * DEG;
  const cosLat = Math.cos(mLat);
  for (let i = 0; i < g.nodeCount; i++) {
    const dx = (g.nodeLon[i] - lon) * cosLat;
    const dy = g.nodeLat[i] - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Straight-line distance (m) between two nodes — used as the A* heuristic. */
export function nodeDistanceM(g: RoutingGraph, a: number, b: number): number {
  return metersBetween(
    { lon: g.nodeLon[a], lat: g.nodeLat[a] },
    { lon: g.nodeLon[b], lat: g.nodeLat[b] },
  );
}
