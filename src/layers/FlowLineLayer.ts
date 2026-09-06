// src/layers/FlowLineLayer.ts
// Wind shown as a lattice of short arrows fixed to every road: columns along the
// carriageway and rows across it, one point every pitchM metres in the road's own
// frame, the pitch chosen per zoom so neighbours sit PITCH_PX apart on screen. Every
// arrow is the same length; each POINTS in the local wind direction of its street (the
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
// Wavelength of the brightness wave, in lattice pitches.
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
/** Target pitch between neighbouring arrows on screen, desktop; phones add PHONE_EXTRA_PX. */
const PITCH_PX = 26;
/** Every arrow is this long on screen: 0.73 of the pitch, closely packed, never touching. */
const ARROW_PX = 19;
const PHONE_EXTRA_PX = 2;
/** A road's own lattice is never thinned; only a duplicate point (a piece boundary, a sharp bend) is dropped. */
const SAME_WAY_SEP = 0.5;
/** Another road's arrow this close to a kept one loses; the higher-ranked road keeps its whole lattice. */
const OTHER_WAY_SEP = 0.7;
/** Rows stay this far inside the carriageway edge. */
const EDGE_MARGIN_M = 1.5;
/** Carriageway width by class rank (0 arterial … 5 service), metres. */
const CLASS_ROAD_M = [16, 13, 10, 7, 3.5, 5];

/** The carriageway the lattice fills: the class width, never more than the canyon. */
export function roadWidthM(rank: number, canyonW: number): number {
  const cls = CLASS_ROAD_M[Math.min(Math.max(rank, 0), 5)];
  return canyonW > 0 ? Math.min(cls, canyonW) : cls;
}

/** The lattice pitch in whole metres for a zoom: at least PITCH_PX on screen. */
export function pitchM(mpp: number, isMobile = false): number {
  return Math.max(1, Math.ceil((PITCH_PX + (isMobile ? PHONE_EXTRA_PX : 0)) * mpp));
}

/**
 * Row offsets across a carriageway of half-width halfW (already less the edge margin)
 * at pitch p: as many rows as fit at spacing p, centred on the centreline, each
 * rounded to a whole metre away from zero. One row (the centreline) when only one fits.
 */
export function rowOffsetsM(halfW: number, p: number): number[] {
  const n = Math.max(1, Math.floor((2 * Math.max(0, halfW)) / p) + 1);
  const out: number[] = [];
  for (let m = 0; m < n; m++) {
    const o = (m - (n - 1) / 2) * p;
    out.push(o === 0 ? 0 : Math.sign(o) * Math.round(Math.abs(o)));
  }
  return out;
}

/**
 * The arrow field. Every road carries a lattice in its own frame: columns along it
 * every pitchM metres from its first node (the pipeline gives each piece its startM),
 * rows across it at the same pitch, as many as fit inside the carriageway
 * (rowOffsetsM). The pitch is whole metres, chosen per zoom so neighbours sit at least
 * PITCH_PX apart on screen; at a given zoom the lattice is fixed to the road and
 * nothing about it depends on the viewport, the time, or the wind. Zooming changes
 * the pitch, so which metre marks carry an arrow changes; panning never does.
 *
 * A road's own lattice is never thinned: every column and every row is drawn in
 * full, so a straight road reads as a regular grid. Contention exists only between
 * different roads — a junction, a cycleway beside its road, a block grid seen from
 * far out. Roads are taken in rank order (arterial > residential > cycleway >
 * service, then lower way id), a road's points centre row first; a point is kept
 * unless it lies within OTHER_WAY_SEP × pitch of a kept point of another road, or
 * within SAME_WAY_SEP × pitch of one of its own (a piece boundary counted twice, the
 * inside of a sharp bend). Deterministic: the same view always draws the same arrows.
 */
export function buildFlowField(segments: RawSegment[], wind: Wind, opts: FlowFieldOptions): FlowLine[] {
  const { mpp } = opts;
  if (segments.length === 0 || !(mpp > 0)) return [];
  const sizePx = ARROW_PX + (opts.isMobile ? PHONE_EXTRA_PX : 0);
  const lat0 = segments[0].lat * DEG;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0);
  const p = pitchM(mpp, opts.isMobile);

  interface Cand { seg: SegmentInput; raw: RawSegment; cw: ReturnType<typeof computeSegmentCenterWind>; alongM: number; crossM: number; rank: number; i: number; way: string; x: number; y: number }
  const cands: Cand[] = [];
  for (const raw of segments) {
    const seg = normalize(raw);
    const L = seg.segmentLengthM;
    const startM = raw.startM ?? 0;
    const rank = raw.classRank ?? 3;
    const cw = computeSegmentCenterWind(seg, wind);
    const rows = rowOffsetsM(roadWidthM(rank, seg.canyonW) / 2 - EDGE_MARGIN_M, p);
    const i0 = Math.ceil(startM / p);
    const i1 = Math.floor((startM + L) / p);
    const way = String(raw.wayId);
    for (let i = i0; i <= i1; i++) {
      const alongM = i * p - startM - L / 2; // relative to the piece's midpoint
      const p0 = offsetAlongBearing({ lon: seg.lon, lat: seg.lat }, seg.bearingDeg, alongM);
      for (const crossM of rows) {
        const q = crossM === 0 ? p0 : offsetAlongBearing(p0, seg.bearingDeg + 90, crossM);
        cands.push({ seg, raw, cw, alongM, crossM, rank, i, way, x: q.lon * mPerDegLon, y: q.lat * M_PER_DEG_LAT });
      }
    }
  }

  // Priority: rank, then way id, then the centre row outward, then along the way.
  cands.sort((a, b) =>
    a.rank - b.rank
    || (a.way < b.way ? -1 : a.way > b.way ? 1 : 0)
    || Math.abs(a.crossM) - Math.abs(b.crossM)
    || a.i - b.i);

  // Spatial hash on the pitch; both separations are under one pitch, so the 3 × 3
  // neighbourhood holds every point that could be too close.
  const sameSep = SAME_WAY_SEP * p, otherSep = OTHER_WAY_SEP * p;
  const kept = new Map<string, Cand[]>();
  const accepted: Cand[] = [];
  for (const c of cands) {
    const cx = Math.floor(c.x / p), cy = Math.floor(c.y / p);
    let clash = false;
    for (let dx = -1; dx <= 1 && !clash; dx++) for (let dy = -1; dy <= 1 && !clash; dy++) {
      const near = kept.get((cx + dx) + ',' + (cy + dy));
      if (!near) continue;
      for (const q of near) {
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d < (q.way === c.way ? sameSep : otherSep)) { clash = true; break; }
      }
    }
    if (clash) continue;
    const key = cx + ',' + cy;
    const list = kept.get(key) ?? [];
    list.push(c); kept.set(key, list);
    accepted.push(c);
  }

  const travelRad = ((wind.directionDeg + 180) % 360) * DEG;
  const waveX = Math.sin(travelRad), waveY = Math.cos(travelRad);
  const waveLenM = WAVELENGTH_CELLS * p;
  const out: FlowLine[] = [];
  for (const c of accepted) {
    const cw = c.cw;
    const color = windBandColor(shelterRatio(cw.speedMs, wind.speedMs));
    // Brightness wave travelling downwind across the whole field (see arrowAlpha):
    // phase is the arrow's position along the ambient wind vector, in wavelengths.
    const phase = (((c.x * waveX + c.y * waveY) / waveLenM) % 1 + 1) % 1;
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
