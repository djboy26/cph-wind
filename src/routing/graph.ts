// src/routing/graph.ts
// Builds a routable cycling graph from the road GeoJSON. Ways are split at every
// vertex into directed edges; edges that share a coordinate connect into a graph.
// Each directed edge carries its own travel bearing, so A→B and B→A correctly get
// opposite head/tailwind.

import type { FeatureCollection } from 'geojson';
import { bearing, type CanyonGeometry, type LonLat } from '../math';

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
  /** Canyon geometry of the pipeline piece under this edge's midpoint; undefined = no data (open). */
  canyon?: CanyonGeometry;
}

/** The per-way canyon table (public/data/canyon-by-way.json): wayId -> [[startM, heightM, widthM], …] sorted by startM. */
export type CanyonByWay = Record<string, [number, number, number][]>;

export interface RoutingGraph {
  nodeLon: Float64Array;
  nodeLat: Float64Array;
  nodeCount: number;
  /** adj[nodeIndex] = outgoing directed edges. */
  adj: Edge[][];
  edgeCount: number;
  /** Connected-component id per node (every edge is bidirectional, so this is well defined). */
  component: Int32Array;
  /** Id of the largest component — the routable backbone (~98% of nodes). */
  mainComponent: number;
  /** Directed edges that found a canyon piece in the table. */
  canyonEdges: number;
}

function metersBetween(a: LonLat, b: LonLat): number {
  const mLat = ((a.lat + b.lat) / 2) * DEG;
  const dx = (b.lon - a.lon) * MPER_DEG_LAT * Math.cos(mLat);
  const dy = (b.lat - a.lat) * MPER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

export function buildGraph(roads: FeatureCollection, canyonByWay?: CanyonByWay): RoutingGraph {
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
  let canyonEdges = 0;
  for (const f of roads.features) {
    if (!f.geometry || f.geometry.type !== 'LineString') continue;
    const highway = (f.properties?.highway as string) || 'unclassified';
    if (EXCLUDED.has(highway)) continue;
    const wayId = f.properties?.id as string | number | undefined;
    const coords = f.geometry.coordinates as [number, number][];
    // Pieces of this way, in along-way order, and one shared geometry object per piece.
    const pieces = canyonByWay?.[String(wayId)];
    const pieceGeom: CanyonGeometry[] = pieces ? pieces.map(([, heightM, widthM]) => ({ heightM, widthM })) : [];
    let along = 0; // distance from the way's first node to the current vertex
    let pi = 0; // last piece hit; pieces are sorted so the scan only moves forward

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
      let canyon: CanyonGeometry | undefined;
      if (pieces) {
        const mid = along + lengthM / 2;
        while (pi + 1 < pieces.length && pieces[pi + 1][0] <= mid) pi++;
        canyon = pieceGeom[pi];
        canyonEdges += 2;
      }
      along += lengthM;
      adj[a].push({ to: b, lengthM, bearingDeg: fwd, wayId, highway, canyon });
      adj[b].push({ to: a, lengthM, bearingDeg: (fwd + 180) % 360, wayId, highway, canyon });
      edgeCount += 2;
    }
  }

  while (adj.length < lons.length) adj.push([]);

  // Label connected components. The network is one giant component (~98% of nodes)
  // plus ~130 tiny detached islands (parking aisles, service stubs, severed
  // cycleways). Tracking them lets us snap route clicks to the routable backbone.
  const n = lons.length;
  const component = new Int32Array(n).fill(-1);
  let nComp = 0;
  let mainComponent = 0;
  let mainSize = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (component[s] !== -1) continue;
    let size = 0;
    component[s] = nComp;
    stack.length = 0;
    stack.push(s);
    while (stack.length > 0) {
      const u = stack.pop()!;
      size++;
      for (const e of adj[u]) {
        if (component[e.to] === -1) {
          component[e.to] = nComp;
          stack.push(e.to);
        }
      }
    }
    if (size > mainSize) {
      mainSize = size;
      mainComponent = nComp;
    }
    nComp++;
  }

  return {
    nodeLon: Float64Array.from(lons),
    nodeLat: Float64Array.from(lats),
    nodeCount: n,
    adj,
    edgeCount,
    component,
    mainComponent,
    canyonEdges,
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

/**
 * Nearest node on the routable backbone (the largest connected component).
 * A click can land closest to a detached island (a severed cycleway, a parking
 * aisle); snapping such clicks to the main network guarantees that any start and
 * goal are mutually reachable, so we never falsely report "no route". The few
 * metres of snap are imperceptible next to typical click precision.
 */
export function nearestRoutableNode(g: RoutingGraph, lon: number, lat: number): number {
  let best = -1;
  let bestD = Infinity;
  const cosLat = Math.cos(lat * DEG);
  for (let i = 0; i < g.nodeCount; i++) {
    if (g.component[i] !== g.mainComponent) continue;
    const dx = (g.nodeLon[i] - lon) * cosLat;
    const dy = g.nodeLat[i] - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best >= 0 ? best : nearestNode(g, lon, lat);
}

/** Straight-line distance (m) between two nodes — used as the A* heuristic. */
export function nodeDistanceM(g: RoutingGraph, a: number, b: number): number {
  return metersBetween(
    { lon: g.nodeLon[a], lat: g.nodeLat[a] },
    { lon: g.nodeLon[b], lat: g.nodeLat[b] },
  );
}
