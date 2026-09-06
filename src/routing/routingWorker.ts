// src/routing/routingWorker.ts
// Routing off the main thread. The Greater-Copenhagen cycling graph is ~121k
// nodes / 262k edges, so building it (~hundreds of ms) and running several A*
// searches per request would freeze the UI on a phone. The worker owns the graph
// and does all of that here; the main thread only posts requests and renders the
// results, so the map keeps animating and panning smoothly while routes compute.

import type { FeatureCollection } from 'geojson';
import { buildGraph, nearestRoutableNode, type CanyonByWay, type RoutingGraph } from './graph';
import { planRoutes, type CyclingParams, type RouteOption } from './windRoute';
import type { Wind } from '../math';

interface InitMsg {
  type: 'init';
  roads: FeatureCollection;
  /** public/data/canyon-by-way.json; absent when it failed to load (flat model then). */
  canyon?: CanyonByWay;
}
interface PlanMsg {
  type: 'plan';
  /** Monotonic id so the main thread can ignore stale (superseded) results. */
  reqId: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  wind: Wind;
  /** The rider's bike type as routing params (cyclist/bikeTypes.ts paramsFor). */
  params: CyclingParams;
}
type InMsg = InitMsg | PlanMsg;

export interface ReadyOut {
  type: 'ready';
  nodeCount: number;
  /** Directed edges that found a canyon piece; 0 without the table. */
  canyonEdges: number;
}
export interface RoutesOut {
  type: 'routes';
  reqId: number;
  options: RouteOption[];
}
export type OutMsg = ReadyOut | RoutesOut;

const ctx = self as unknown as Worker;
let graph: RoutingGraph | null = null;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;

  if (msg.type === 'init') {
    graph = buildGraph(msg.roads, msg.canyon);
    ctx.postMessage({ type: 'ready', nodeCount: graph.nodeCount, canyonEdges: graph.canyonEdges } satisfies OutMsg);
    return;
  }

  if (msg.type === 'plan') {
    if (!graph) {
      ctx.postMessage({ type: 'routes', reqId: msg.reqId, options: [] } satisfies OutMsg);
      return;
    }
    const s = nearestRoutableNode(graph, msg.start.lon, msg.start.lat);
    const g = nearestRoutableNode(graph, msg.end.lon, msg.end.lat);
    const options = planRoutes(graph, s, g, msg.wind, msg.params);
    ctx.postMessage({ type: 'routes', reqId: msg.reqId, options } satisfies OutMsg);
  }
};
