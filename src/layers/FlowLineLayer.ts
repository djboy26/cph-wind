// src/layers/FlowLineLayer.ts
// Wind shown as a lattice of short arrows fixed to every road: rows across the
// carriageway and columns along it, one point every LATTICE_M metres in the road's
// own frame, thinned by zoom so neighbours stay PITCH_PX apart on screen. Every arrow
// is the same length; each POINTS in the local wind direction of its street (the
// canyon-modified flowDeg), is COLOURED by shelter and made more or less OPAQUE by
// absolute strength. The lattice belongs to the road and never moves; only the
// arrows' direction comes from the wind. Direction is animated as a soft brightness
// wave travelling downwind through the field.

import { IconLayer } from '@deck.gl/layers';
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
  /** Compass direction the wind flows TOWARD — the arrow points this way. */
  flowDeg: number;
  /** Street axis (deg CW from N) — the lattice's frame. */
  bearingDeg: number;
  /** Lattice offset along the street (m) from the piece's midpoint. */
  baseAlongM: number;
  /** Lattice offset across the street (m), + to the right of the bearing. */
  baseCrossM: number;
  color: [number, number, number];
  /** Glyph size in pixels: the same for every arrow, at every zoom. */
  sizePx: number;
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
/** Lattice points every LATTICE_M along and across each way, in the way's own frame. */
const LATTICE_M = 3;
/** Target pitch between drawn arrows on screen; sets the zoom-dependent thinning. */
const PITCH_PX = 34;
/** Every arrow is this long on screen: 0.65 of the pitch, so neighbours never touch. */
const ARROW_PX = 22;
/** No two arrow centres closer than this fraction of the pitch, whatever cell they fall in. */
const MIN_SEP = 0.75;
/** Rows stay this far inside the carriageway edge. */
const EDGE_MARGIN_M = 1.5;
/** Carriageway width by class rank (0 arterial … 5 service), metres, when the canyon is wider. */
const CLASS_ROAD_M = [16, 13, 10, 7, 3.5, 5];

/** The carriageway the lattice fills: the class width, or half the canyon if that is wider, never more than the canyon. */
export function roadWidthM(rank: number, canyonW: number): number {
  const cls = CLASS_ROAD_M[Math.min(Math.max(rank, 0), 5)];
  if (rank >= 4) return Math.min(cls, canyonW || cls);
  return Math.min(canyonW || cls, Math.max(cls, 0.5 * canyonW));
}

/**
 * The arrow field. Every way carries a lattice of points in its own frame: along the
 * way at i × LATTICE_M from its first node (the pipeline gives each piece its
 * startM), across it at j × LATTICE_M from the centreline, out to the carriageway
 * edge. A point's coordinate never depends on zoom or viewport. Zooming out keeps
 * every k-th row and column, k = ceil(PITCH_PX / (LATTICE_M / mpp)), so the pitch on
 * screen stays within a few pixels of PITCH_PX at every zoom; which points are drawn
 * changes with zoom, where they are does not — rows drop away as the road narrows on
 * screen, positions never move.
 *
 * Where two ways come within a pitch of each other on screen — a cycleway beside its
 * road, a junction, a block grid seen from far out — one candidate per PITCH_PX cell
 * survives by rank (arterial > residential > cycleway > service, then the centre row,
 * then the lower way id, then the lower index), and every survivor is then kept only
 * if its centre is at least MIN_SEP × pitch from every centre already kept. Both
 * passes are deterministic: the same view always draws the same arrows.
 */
export function buildFlowField(segments: RawSegment[], wind: Wind, opts: FlowFieldOptions): FlowLine[] {
  const { mpp } = opts;
  if (segments.length === 0 || !(mpp > 0)) return [];
  const sizePx = ARROW_PX + (opts.isMobile ? 2 : 0);
  const lat0 = segments[0].lat * DEG;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0);
  const cellM = PITCH_PX * mpp;
  const k = Math.max(1, Math.ceil(cellM / LATTICE_M));

  interface Cand { seg: SegmentInput; raw: RawSegment; cw: ReturnType<typeof computeSegmentCenterWind>; alongM: number; crossM: number; rank: number; j: number; i: number; cx: number; cy: number }
  const better = (a: Cand, b: Cand) =>
    a.rank !== b.rank ? a.rank < b.rank
    : a.j !== b.j ? a.j < b.j
    : String(a.raw.wayId) !== String(b.raw.wayId) ? String(a.raw.wayId) < String(b.raw.wayId)
    : a.i < b.i;
  const cells = new Map<string, Cand>();

  for (const raw of segments) {
    const seg = normalize(raw);
    const L = seg.segmentLengthM;
    const startM = raw.startM ?? 0;
    const rank = raw.classRank ?? 3;
    const cw = computeSegmentCenterWind(seg, wind);
    const halfW = roadWidthM(rank, seg.canyonW) / 2 - EDGE_MARGIN_M;
    const jMax = Math.max(0, Math.floor(halfW / LATTICE_M));
    const i0 = Math.ceil(startM / LATTICE_M);
    const i1 = Math.floor((startM + L) / LATTICE_M);
    for (let i = i0; i <= i1; i++) {
      if (i % k !== 0) continue;
      const alongM = i * LATTICE_M - startM - L / 2; // relative to the piece's midpoint
      const p0 = offsetAlongBearing({ lon: seg.lon, lat: seg.lat }, seg.bearingDeg, alongM);
      for (let j = -jMax; j <= jMax; j++) {
        if (j % k !== 0) continue;
        const crossM = j * LATTICE_M;
        const p = crossM === 0 ? p0 : offsetAlongBearing(p0, seg.bearingDeg + 90, crossM);
        const xM = p.lon * mPerDegLon;
        const yM = p.lat * M_PER_DEG_LAT;
        const cx = Math.floor(xM / cellM);
        const cy = Math.floor(yM / cellM);
        const key = cx + ',' + cy;
        const cand: Cand = { seg, raw, cw, alongM, crossM, rank, j: Math.abs(j), i, cx, cy };
        const cur = cells.get(key);
        if (!cur || better(cand, cur)) cells.set(key, cand);
      }
    }
  }

  // Second pass: a cell winner can still sit a pixel from a winner across the cell
  // edge, so enforce a true minimum separation between centres. Winners are taken in
  // priority order; each is kept only if no already-kept centre in the 3 × 3
  // neighbourhood is closer than MIN_SEP × pitch. Arrows are ARROW_PX long, under
  // that separation, so kept arrows never touch.
  const minSep = MIN_SEP * cellM;
  const kept = new Map<string, { x: number; y: number }[]>();
  const winners = [...cells.values()].sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
  const accepted: Cand[] = [];
  for (const c of winners) {
    const [lon, lat] = arrowPosition({ lon: c.seg.lon, lat: c.seg.lat, bearingDeg: c.seg.bearingDeg, baseAlongM: c.alongM, baseCrossM: c.crossM });
    const x = lon * mPerDegLon, y = lat * M_PER_DEG_LAT;
    let clash = false;
    for (let dx = -1; dx <= 1 && !clash; dx++) for (let dy = -1; dy <= 1 && !clash; dy++) {
      const near = kept.get((c.cx + dx) + ',' + (c.cy + dy));
      if (near) for (const q of near) if (Math.hypot(q.x - x, q.y - y) < minSep) { clash = true; break; }
    }
    if (clash) continue;
    const key = c.cx + ',' + c.cy;
    const list = kept.get(key) ?? [];
    list.push({ x, y }); kept.set(key, list);
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
    out.push({
      lon: c.seg.lon, lat: c.seg.lat,
      flowDeg: cw.flowDeg, bearingDeg: c.seg.bearingDeg,
      baseAlongM: c.alongM, baseCrossM: c.crossM,
      color, sizePx, alpha: alphaForSpeed(cw.speedMs), phase,
      speedMs: cw.speedMs, gustMs: cw.gustMs,
      canyonH: c.seg.canyonH, canyonW: c.seg.canyonW,
      leftHeightM: c.seg.leftHeightM, rightHeightM: c.seg.rightHeightM,
      geometrySource: c.seg.geometrySource, wayId: c.raw.wayId,
    });
  }
  return out;
}

/** The arrow's centre: the piece's midpoint, then along the road, then across it. */
function arrowPosition(d: Pick<FlowLine, 'lon' | 'lat' | 'bearingDeg' | 'baseAlongM' | 'baseCrossM'>): [number, number] {
  const along = offsetAlongBearing({ lon: d.lon, lat: d.lat }, d.bearingDeg, d.baseAlongM);
  const p = d.baseCrossM === 0 ? along : offsetAlongBearing(along, d.bearingDeg + 90, d.baseCrossM);
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
  /** Continuously increasing seconds — drives the brightness wave. */
  time: number;
  /** Kept for the caller; the glyph size is decided in buildFlowField. */
  isMobile: boolean;
  onHover?: (info: { object?: FlowLine; x: number; y: number }) => void;
  onClick?: (info: { object?: FlowLine; x: number; y: number }) => boolean;
}

/** One IconLayer: the arrow glyph, one size, rotated to the wind. */
export function createFlowLineLayer({ data, time, onHover, onClick }: FlowLineLayerOpts): Layer[] {
  return [
    new IconLayer<FlowLine>({
      id: 'wind-flow-arrows',
      data,
      getIcon: () => 'arrow',
      iconAtlas: '/arrow.svg',
      iconMapping: { arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } },
      sizeUnits: 'pixels',
      getSize: (d) => d.sizePx,
      getPosition: (d) => arrowPosition(d),
      getAngle: (d) => 90 - d.flowDeg,
      getColor: (d) => {
        const a = arrowAlpha(d, time);
        return [d.color[0], d.color[1], d.color[2], Math.round(255 * a)];
      },
      pickable: true,
      billboard: false,
      onHover,
      onClick,
      updateTriggers: { getColor: time },
    }),
  ];
}
