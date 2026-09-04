// src/layers/FlowLineLayer.ts
// Wind shown as a field of arrows fixed to the roads: every way carries arrows at
// fixed points every SPACING_M along it, thinned by zoom so neighbours stay PITCH_PX
// apart on screen and never overlap. Each arrow POINTS in the local wind direction of
// its street (the canyon-modified flowDeg), is COLOURED by shelter and made more or
// less OPAQUE by absolute strength; every arrow is the same length. Nothing moves:
// direction is animated as a soft brightness wave travelling downwind through the
// field.

import { IconLayer, LineLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import {
  computeSegmentCenterWind,
  offsetAlongBearing,
  type GeometrySource,
  type SegmentInput,
  type Wind,
} from '../math';
import { windBandColor, shelterRatio } from '../cyclist/windCategory';
import type { RawSegment } from './buildWindArrows';

const DEG = Math.PI / 180;
// Brightness-wave speed, cycles per second (period 4 s).
const RATE = 0.25;
// Wavelength of the brightness wave, in screen cells of PITCH_PX.
const WAVELENGTH_CELLS = 6;

export interface FlowLine {
  lon: number;
  lat: number;
  /** Compass direction the wind flows TOWARD — the arrow points AND drifts this way. */
  flowDeg: number;
  /** Street axis (deg CW from N) — used to place arrows along the centerline. */
  bearingDeg: number;
  /** Offset along the street (m) from the segment centre; 0 when on the lattice. */
  baseAlongM: number;
  /** Arrow length in metres: the road's carriageway, floored at ARROW_MIN_PX on screen. */
  lenM: number;
  color: [number, number, number];
  /** Arrowhead size in pixels, scaled with the arrow's on-screen length. */
  sizePx: number;
  /** Shaft width in pixels, likewise. */
  shaftPx: number;
  /** Base opacity 0.55–1 from absolute street-level speed (alphaForSpeed). */
  alpha: number;
  /** Position along the ambient wind vector in brightness-wave wavelengths, 0..1. */
  phase: number;
  // --- carried for the tooltip ---
  speedMs: number;
  gustMs?: number;
  canyonH: number;
  canyonW: number;
  leftHeightM: number;
  rightHeightM: number;
  geometrySource: GeometrySource;
  wayId: string | number | undefined;
}

function normalize(seg: RawSegment): SegmentInput {
  const widthM = seg.widthM ?? seg.canyonW;
  return {
    lon: seg.lon,
    lat: seg.lat,
    bearingDeg: seg.bearingDeg,
    segmentLengthM: seg.segmentLengthM ?? 30,
    widthM,
    leftDistM: seg.leftDistM ?? widthM / 2,
    rightDistM: seg.rightDistM ?? widthM / 2,
    leftHeightM: seg.leftHeightM ?? seg.canyonH,
    rightHeightM: seg.rightHeightM ?? seg.canyonH,
    canyonH: seg.canyonH,
    canyonW: seg.canyonW,
    laneOffsetsM: seg.laneOffsetsM ?? [0, 0, 0, 0, 0],
    geometrySource: (seg.geometrySource ?? 'fallback') as GeometrySource,
  };
}

// TWO CHANNELS, DELIBERATELY. Colour carries SHELTER — street / ambient, a ratio,
// "which streets are sheltered today" (windBandColor + shelterRatio). Opacity carries
// ABSOLUTE STRENGTH in m/s, "how much wind is actually on this street": a calm day's
// field is translucent, a gale's is solid. Every arrow is the same length, so the
// field reads as a field and the two channels never fight over the glyph.
//
// Do NOT "fix" this to size arrows by speed again, and do NOT make opacity a ratio:
// that collapses the map to one channel and drops absolute strength from it.
function alphaForSpeed(speedMs: number): number {
  return 0.55 + 0.45 * Math.max(0, Math.min(1, speedMs / 5));
}

export interface FlowFieldOptions {
  /** Metres per screen pixel at the current zoom. */
  mpp: number;
  /** Phones get a slightly larger glyph. */
  isMobile?: boolean;
}

const M_PER_DEG_LAT = 111320;
/** Arrows live at fixed points every SPACING_M along every way, from its first node. */
const SPACING_M = 3;
/** The closest two drawn arrows may be on screen; sets the zoom-dependent decimation. */
const PITCH_PX = 28;
/** Arrowhead and shaft scale with the arrow: head 15 % of its length within 12–36 px, shaft 3 % within 2–8 px. */
const HEAD_MIN_PX = 12, HEAD_MAX_PX = 36, HEAD_OF_LENGTH = 0.15;
const SHAFT_MIN_PX = 2, SHAFT_MAX_PX = 8, SHAFT_OF_LENGTH = 0.03;
/** No two arrow centres closer than this fraction of PITCH_PX, whatever cell they fall in. */
const MIN_SEP = 0.75;
/** An arrow spans its road's carriageway, but never draws shorter than this on screen. */
const ARROW_MIN_PX = 16;
/** Along-road spacing target as a fraction of the arrow's on-screen length (DJ's sketch: 0.4). */
const SPACING_OF_LENGTH = 0.4;
/** Two parallel arrows need this much perpendicular clearance, and this much tip-to-tail. */
const CLEAR_ACROSS_PX = 24;
const CLEAR_ALONG_PX = 12;
/** Carriageway width by class rank (0 arterial … 5 service), metres, when the canyon is wider. */
const CLASS_ROAD_M = [16, 13, 10, 7, 3.5, 5];

/** The carriageway an arrow spans: the class width, or half the canyon if that is wider, never more than the canyon. */
function roadWidthM(rank: number, canyonW: number): number {
  const cls = CLASS_ROAD_M[Math.min(Math.max(rank, 0), 5)];
  if (rank >= 4) return Math.min(cls, canyonW || cls);
  return Math.min(canyonW || cls, Math.max(cls, 0.5 * canyonW));
}

/**
 * The arrow field. Every way carries candidate points at fixed world positions
 * i × SPACING_M from its first node (the pipeline gives each piece its startM), so an
 * arrow's coordinate never depends on the zoom or the viewport. Zooming out keeps
 * every k-th point, k = ceil(PITCH_PX / (SPACING_M / mpp)), so the drawn set at any
 * zoom is a subset of the set at any closer zoom and nothing ever shifts.
 *
 * Where two ways come within PITCH_PX of each other on screen — a cycleway beside its
 * road, a dense block grid seen from far out — they share a PITCH_PX cell and the
 * higher-ranked way keeps it (arterial > residential > cycleway > service; then the
 * centre row, then the lower way id). Deterministic, so the same view always draws
 * the same arrows.
 *
 * Wide roads get lateral rows ROW_M apart out to CROSS_FRACTION of their canyon width
 * once zoomed in far enough for the rows to be more than a pitch apart.
 */
export function buildFlowField(segments: RawSegment[], wind: Wind, opts: FlowFieldOptions): FlowLine[] {
  const { mpp } = opts;
  if (segments.length === 0 || !(mpp > 0)) return [];
  const bump = opts.isMobile ? 2 : 0;
  const lat0 = segments[0].lat * DEG;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0);
  const cellM = PITCH_PX * mpp;

  interface Cand { seg: SegmentInput; raw: RawSegment; cw: ReturnType<typeof computeSegmentCenterWind>; alongM: number; lenM: number; rank: number; i: number; cx: number; cy: number }
  const better = (a: Cand, b: Cand) =>
    a.rank !== b.rank ? a.rank < b.rank
    : String(a.raw.wayId) !== String(b.raw.wayId) ? String(a.raw.wayId) < String(b.raw.wayId)
    : a.i < b.i;
  const cells = new Map<string, Cand>();

  for (const raw of segments) {
    const seg = normalize(raw);
    const L = seg.segmentLengthM;
    const startM = raw.startM ?? 0;
    const rank = raw.classRank ?? 3;
    const cw = computeSegmentCenterWind(seg, wind);

    // The arrow spans the carriageway, floored on screen; its along-road spacing is a
    // fraction of its length, but never so tight that parallel arrows touch. Two arrows
    // s apart along the road, both pointing the same way at angle θ to the road, are
    // s·sinθ apart across and s·cosθ apart along their own axis; either clearance will do.
    const lenM = Math.max(ARROW_MIN_PX * mpp, roadWidthM(rank, seg.canyonW));
    const lenPx = lenM / mpp;
    const theta = Math.abs(((cw.flowDeg - seg.bearingDeg) % 180 + 180) % 180);
    const sin = Math.sin(theta * DEG), cos = Math.abs(Math.cos(theta * DEG));
    const sMinPx = Math.min(CLEAR_ACROSS_PX / Math.max(sin, 1e-3), (lenPx + CLEAR_ALONG_PX) / Math.max(cos, 1e-3));
    const sPx = Math.max(PITCH_PX, SPACING_OF_LENGTH * lenPx, sMinPx);
    const k = Math.max(1, Math.ceil((sPx * mpp) / SPACING_M));

    const i0 = Math.ceil(startM / SPACING_M);
    const i1 = Math.floor((startM + L) / SPACING_M);
    for (let i = i0; i <= i1; i++) {
      if (i % k !== 0) continue;
      const alongM = i * SPACING_M - startM - L / 2; // relative to the piece's midpoint
      const p = offsetAlongBearing({ lon: seg.lon, lat: seg.lat }, seg.bearingDeg, alongM);
      const xM = p.lon * mPerDegLon;
      const yM = p.lat * M_PER_DEG_LAT;
      const cx = Math.floor(xM / cellM);
      const cy = Math.floor(yM / cellM);
      const key = cx + ',' + cy;
      const cand: Cand = { seg, raw, cw, alongM, lenM, rank, i, cx, cy };
      const cur = cells.get(key);
      if (!cur || better(cand, cur)) cells.set(key, cand);
    }
  }

  // Second pass: a cell winner can still overlap a winner from another cell — a
  // cycleway's arrow lying across its road's, or two long arrows near a junction. Treat
  // every arrow as a capsule (its length plus CLEAR_ALONG tip to tail, CLEAR_ACROSS
  // wide) and, taking winners in priority order, keep each only if its centre lies
  // outside every kept capsule and no kept centre is within MIN_SEP × pitch. Both
  // rules are deterministic, so the same view always draws the same arrows.
  const minSep = MIN_SEP * cellM;
  const clearAcross = CLEAR_ACROSS_PX * mpp;
  const clearAlong = CLEAR_ALONG_PX * mpp;
  interface Kept { x: number; y: number; ux: number; uy: number; half: number }
  const kept = new Map<string, Kept[]>();
  let maxHalf = 0; // longest half-length kept so far; bounds how far a clash can reach
  const winners = [...cells.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const accepted: Cand[] = [];
  for (const c of winners) {
    const p = offsetAlongBearing({ lon: c.seg.lon, lat: c.seg.lat }, c.seg.bearingDeg, c.alongM);
    const x = p.lon * mPerDegLon, y = p.lat * M_PER_DEG_LAT;
    const half = c.lenM / 2;
    const rad = c.cw.flowDeg * DEG;
    const ux = Math.sin(rad), uy = Math.cos(rad);
    // Overlap is tested in both arrows' frames: two arrows crossing at an angle can be
    // clear along one axis and still cut through the other.
    const cuts = (ex: number, ey: number, ax: number, ay: number, halves: number) =>
      Math.abs(-ex * ay + ey * ax) < clearAcross && Math.abs(ex * ax + ey * ay) < halves;
    // Cells to search: the longest kept half plus this half plus the gap, in cells.
    const reach = Math.ceil((maxHalf + half + clearAlong) / cellM) + 1;
    let clash = false;
    for (let dx = -reach; dx <= reach && !clash; dx++) for (let dy = -reach; dy <= reach && !clash; dy++) {
      const near = kept.get((c.cx + dx) + ',' + (c.cy + dy));
      if (!near) continue;
      for (const q of near) {
        const ex = x - q.x, ey = y - q.y;
        if (Math.hypot(ex, ey) < minSep) { clash = true; break; }
        const halves = q.half + half + clearAlong;
        if (cuts(ex, ey, q.ux, q.uy, halves) || cuts(ex, ey, ux, uy, halves)) { clash = true; break; }
      }
    }
    if (clash) continue;
    const key = c.cx + ',' + c.cy;
    const list = kept.get(key) ?? [];
    list.push({ x, y, ux, uy, half });
    kept.set(key, list);
    maxHalf = Math.max(maxHalf, half);
    accepted.push(c);
  }

  const travelRad = ((wind.directionDeg + 180) % 360) * DEG;
  const waveX = Math.sin(travelRad), waveY = Math.cos(travelRad);
  const out: FlowLine[] = [];
  for (const c of accepted) {
    const cw = c.cw;
    const color = windBandColor(shelterRatio(cw.speedMs, wind.speedMs));
    // Brightness wave travelling downwind across the whole field (see arrowAlpha):
    // phase is the arrow's position along the ambient wind vector, in wavelengths.
    const xM = (c.cx + 0.5) * cellM, yM = (c.cy + 0.5) * cellM;
    const phase = (((xM * waveX + yM * waveY) / (WAVELENGTH_CELLS * cellM)) % 1 + 1) % 1;
    const lenPx = c.lenM / mpp;
    out.push({
      lon: c.seg.lon, lat: c.seg.lat,
      flowDeg: cw.flowDeg, bearingDeg: c.seg.bearingDeg,
      baseAlongM: c.alongM, lenM: c.lenM,
      color,
      sizePx: Math.max(HEAD_MIN_PX, Math.min(HEAD_MAX_PX, HEAD_OF_LENGTH * lenPx)) + bump,
      shaftPx: Math.max(SHAFT_MIN_PX, Math.min(SHAFT_MAX_PX, SHAFT_OF_LENGTH * lenPx)) + bump / 2,
      alpha: alphaForSpeed(cw.speedMs), phase,
      speedMs: cw.speedMs, gustMs: cw.gustMs,
      canyonH: c.seg.canyonH, canyonW: c.seg.canyonW,
      leftHeightM: c.seg.leftHeightM, rightHeightM: c.seg.rightHeightM,
      geometrySource: c.seg.geometrySource, wayId: c.raw.wayId,
    });
  }
  return out;
}

/** The arrow's centre: on the road, alongM from the piece's midpoint. */
function arrowCentre(d: FlowLine): { lon: number; lat: number } {
  return offsetAlongBearing({ lon: d.lon, lat: d.lat }, d.bearingDeg, d.baseAlongM);
}
function arrowTail(d: FlowLine): [number, number] {
  const p = offsetAlongBearing(arrowCentre(d), d.flowDeg + 180, d.lenM / 2);
  return [p.lon, p.lat];
}
function arrowHead(d: FlowLine): [number, number] {
  const p = offsetAlongBearing(arrowCentre(d), d.flowDeg, d.lenM / 2);
  return [p.lon, p.lat];
}
/** Where the shaft stops: inside the head, so the tip is the glyph's own point. */
function arrowShaftEnd(d: FlowLine, mpp: number): [number, number] {
  const p = offsetAlongBearing(arrowCentre(d), d.flowDeg, d.lenM / 2 - 0.6 * d.sizePx * mpp);
  return [p.lon, p.lat];
}

// Arrows never move and never vanish. Direction is animated as a soft brightness wave
// that travels downwind through the field: the arrow's own opacity (speed) modulated
// by ±WAVE_DEPTH.
const WAVE_DEPTH = 0.15;
function arrowAlpha(d: FlowLine, time: number): number {
  const w = Math.sin(2 * Math.PI * (d.phase - time * RATE));
  return d.alpha * (1 - WAVE_DEPTH + WAVE_DEPTH * w);
}

interface FlowLineLayerOpts {
  data: FlowLine[];
  /** Metres per pixel, so the shaft can stop a head-length short of the tip. */
  mpp: number;
  /** Continuously increasing seconds — drives the conveyor. */
  time: number;
  /** Kept for the caller; the glyph size is decided in buildFlowField. */
  isMobile: boolean;
  onHover?: (info: { object?: FlowLine; x: number; y: number }) => void;
  onClick?: (info: { object?: FlowLine; x: number; y: number }) => boolean;
}

/**
 * Two layers per field: a thin shaft from tail to tip, and a head glyph at the tip.
 * Both carry the same FlowLine objects, so picking either gives the tooltip its street.
 */
export function createFlowLineLayer({ data, time, mpp, onHover, onClick }: FlowLineLayerOpts): Layer[] {
  const rgba = (d: FlowLine): [number, number, number, number] => {
    const a = arrowAlpha(d, time);
    return [d.color[0], d.color[1], d.color[2], Math.round(255 * a)];
  };
  return [
    new LineLayer<FlowLine>({
      id: 'wind-flow-shafts',
      data,
      getSourcePosition: (d) => arrowTail(d),
      getTargetPosition: (d) => arrowShaftEnd(d, mpp),
      getColor: rgba,
      getWidth: (d) => d.shaftPx,
      widthUnits: 'pixels',
      pickable: true,
      onHover,
      onClick,
      updateTriggers: { getColor: time },
    }),
    new IconLayer<FlowLine>({
      id: 'wind-flow-heads',
      data,
      getIcon: () => 'head',
      iconAtlas: '/arrowhead.svg',
      // Anchor at the tip (x = 60 of 64) so the head ends exactly where the shaft does.
      iconMapping: { head: { x: 0, y: 0, width: 64, height: 64, anchorX: 60, anchorY: 32, mask: true } },
      sizeUnits: 'pixels',
      getSize: (d) => d.sizePx,
      getPosition: (d) => arrowHead(d),
      getAngle: (d) => 90 - d.flowDeg,
      getColor: rgba,
      pickable: true,
      billboard: false,
      onHover,
      onClick,
      updateTriggers: { getColor: time },
    }),
  ];
}
