// src/layers/computeArrows.ts
// Pre-computes per-segment arrow data: midpoint + street bearing.
// Static — depends only on road geometry, not on wind. Runs once.

import type { FeatureCollection, LineString } from 'geojson';
import { bearing, midpoint, type LonLat } from '../math';

export interface ArrowDatum {
  wayId: string | number | undefined;
  lon: number;
  lat: number;
  /** Bearing from segment start A to end B, degrees CW from north [0, 360). */
  bearingDeg: number;
}

/** Filter out micro-segments shorter than this (meters). OSM intersections produce a lot of these. */
const MIN_SEGMENT_M = 20;

function approxLengthMeters(a: LonLat, b: LonLat): number {
  const meanLat = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dx = (b.lon - a.lon) * 111_000 * Math.cos(meanLat);
  const dy = (b.lat - a.lat) * 111_000;
  return Math.sqrt(dx * dx + dy * dy);
}

export function computeArrows(roads: FeatureCollection): ArrowDatum[] {
  const out: ArrowDatum[] = [];

  for (const feature of roads.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const coords = (feature.geometry as LineString).coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
      const a: LonLat = { lon: coords[i][0], lat: coords[i][1] };
      const b: LonLat = { lon: coords[i + 1][0], lat: coords[i + 1][1] };

      if (approxLengthMeters(a, b) < MIN_SEGMENT_M) continue;

      const m = midpoint(a, b);
      out.push({
        wayId: feature.id,
        lon: m.lon,
        lat: m.lat,
        bearingDeg: bearing(a, b),
      });
    }
  }

  return out;
}