// src/routing/pathfind.ts
// A* shortest path with a pluggable edge cost, plus diverse alternative routes via
// the iterative edge-penalty method (find a path, penalize its edges, find another).

import { nodeDistanceM, type Edge, type RoutingGraph } from './graph';

export interface RoutePath {
  /** Node indices from start to goal. */
  nodes: number[];
  /** Directed edges traversed, in order. */
  edges: Edge[];
  /** Total cost under the cost function used. */
  cost: number;
  /** Total physical distance, meters. */
  distanceM: number;
}

/** Edge cost in the same unit as the heuristic. `edge.lengthM / refSpeed` for time. */
export type EdgeCost = (edge: Edge) => number;

// Min-heap keyed by f-score.
class MinHeap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, f: number) {
    this.ids.push(id);
    this.fs.push(f);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.fs[p] <= this.fs[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastF = this.fs.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.fs[0] = lastF;
      let i = 0;
      const n = this.ids.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < n && this.fs[l] < this.fs[s]) s = l;
        if (r < n && this.fs[r] < this.fs[s]) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(i: number, j: number) {
    [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
    [this.fs[i], this.fs[j]] = [this.fs[j], this.fs[i]];
  }
}

/**
 * A* from `start` to `goal`.
 * @param edgeCost   cost per directed edge (any positive unit)
 * @param refSpeed   max plausible "speed" in cost-units per meter's inverse, i.e.
 *                   heuristic = straight-line-distance / refSpeed, kept admissible
 *                   by passing the LOWEST cost-per-meter any edge can have.
 * @param penalty    optional multiplier applied to specific edges (for alternatives)
 */
export function aStar(
  g: RoutingGraph,
  start: number,
  goal: number,
  edgeCost: EdgeCost,
  minCostPerMeter: number,
  penalty?: (fromNode: number, edge: Edge) => number,
): RoutePath | null {
  if (start === goal) return { nodes: [start], edges: [], cost: 0, distanceM: 0 };

  const gScore = new Float64Array(g.nodeCount).fill(Infinity);
  const cameFrom = new Int32Array(g.nodeCount).fill(-1);
  const cameEdge: (Edge | null)[] = new Array(g.nodeCount).fill(null);
  const closed = new Uint8Array(g.nodeCount);

  gScore[start] = 0;
  const open = new MinHeap();
  const h = (n: number) => nodeDistanceM(g, n, goal) * minCostPerMeter;
  open.push(start, h(start));

  while (open.size > 0) {
    const current = open.pop();
    if (current === goal) break;
    if (closed[current]) continue;
    closed[current] = 1;

    for (const edge of g.adj[current]) {
      let step = edgeCost(edge);
      if (penalty) step *= penalty(current, edge);
      const tentative = gScore[current] + step;
      if (tentative < gScore[edge.to]) {
        gScore[edge.to] = tentative;
        cameFrom[edge.to] = current;
        cameEdge[edge.to] = edge;
        open.push(edge.to, tentative + h(edge.to));
      }
    }
  }

  if (gScore[goal] === Infinity) return null;

  const nodes: number[] = [];
  const edges: Edge[] = [];
  let distanceM = 0;
  let n = goal;
  while (n !== -1) {
    nodes.push(n);
    const e = cameEdge[n];
    if (e) {
      edges.push(e);
      distanceM += e.lengthM;
    }
    if (n === start) break;
    n = cameFrom[n];
  }
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, cost: gScore[goal], distanceM };
}

/** Fraction of edge overlap between two routes (by way+node signature). */
function overlap(a: RoutePath, b: RoutePath): number {
  const sig = (p: RoutePath) => new Set(p.nodes.map((n, i) => (i > 0 ? `${p.nodes[i - 1]}-${n}` : '')));
  const sa = sig(a);
  const sb = sig(b);
  let shared = 0;
  for (const s of sb) if (sa.has(s)) shared++;
  return shared / Math.max(sa.size, sb.size, 1);
}

/**
 * Generate up to `k` distinct routes. The first is the base optimum; each next is
 * found after penalizing the edges already used, yielding diverse alternatives.
 * Routes that overlap an existing one by more than `maxOverlap` are discarded.
 */
export function alternativeRoutes(
  g: RoutingGraph,
  start: number,
  goal: number,
  edgeCost: EdgeCost,
  minCostPerMeter: number,
  k = 3,
  penaltyFactor = 2.5,
  maxOverlap = 0.7,
): RoutePath[] {
  const routes: RoutePath[] = [];
  const usedKey = new Set<string>();
  const keyOf = (from: number, e: Edge) => `${from}->${e.to}`;

  for (let attempt = 0; attempt < k * 3 && routes.length < k; attempt++) {
    const penalty = (from: number, e: Edge) => (usedKey.has(keyOf(from, e)) ? penaltyFactor : 1);
    const route = aStar(g, start, goal, edgeCost, minCostPerMeter, attempt === 0 ? undefined : penalty);
    if (!route) break;

    const tooSimilar = routes.some((r) => overlap(r, route) > maxOverlap);
    if (!tooSimilar) routes.push(route);

    // Penalize this route's edges so the next search diverges.
    for (let i = 1; i < route.nodes.length; i++) {
      usedKey.add(`${route.nodes[i - 1]}->${route.nodes[i]}`);
    }
  }
  return routes;
}
