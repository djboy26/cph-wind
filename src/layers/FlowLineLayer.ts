// src/layers/FlowLineLayer.ts
// Wind shown as a lattice of arrows: one per ARROW_SPACING_PX screen cell at every
// zoom. Each arrow POINTS in the local wind direction of the street it stands for
// (the canyon-modified flowDeg), is SIZED by absolute wind strength and COLOURED by
// shelter. Zoomed out the arrow sits on its cell centre (a regular grid); zoomed in
// it sits on the road. Nothing moves: direction is animated as a soft brightness
// wave travelling downwind through the lattice.

import { IconLayer } from '@deck.gl/layers';
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
// Wavelength of the brightness wave, in lattice cells.
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
  /** Offset across the street (m), + to the right of the bearing; 0 unless the road is wide. */
  baseCrossM: number;
  color: [number, number, number];
  /** Arrow size in PIXELS (bigger = stronger wind) — the same at every zoom. */
  sizePx: number;
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
// "which streets are sheltered today" (windBandColor + shelterRatio, above). Size
// carries ABSOLUTE STRENGTH in m/s, "how much wind is actually on this street".
//
// They answer different questions and a rider needs both: a deeply sheltered street
// on a gale day still has real wind in it, and an open street on a calm day does not.
// Do NOT "fix" this function to take the ratio as well. That collapses the map to one
// channel and drops absolute strength, which since step 3c is shown nowhere else on
// the map — only in the tooltip.
//
// Pixels. Sized like a quiver plot: the longest arrow is ~0.7 of the 32 px lattice
// pitch, so the field reads as a field rather than as dots with gaps, and two
// neighbours pointing along the same lattice axis still keep a 10 px gap.
// 14 px is the smallest size at which the head still reads on a light ground.
function sizeForSpeed(speedMs: number): number {
  return Math.max(14, Math.min(22, 14 + speedMs * 1.6));
}

export interface FlowFieldOptions {
  /** Lattice pitch in metres at the current zoom: ARROW_SPACING_PX × metres-per-pixel. */
  spacingM: number;
  /** Zoom >= 16: arrows sit on the road they stand for. Below: on the cell centre. */
  onRoad: boolean;
}

const M_PER_DEG_LAT = 111320;
// How far across a wide street the extra rows may reach, as a fraction of canyon width.
const CROSS_FRACTION = 0.3;

/**
 * One arrow per grid cell. Every segment offers candidate points every `spacingM`
 * along its axis (at least its centre); the candidates are binned into square
 * cells `spacingM` wide in local metres and the one nearest each cell's centre wins.
 * Two regimes fall out of one rule: zoomed in, cells are smaller than segments and
 * arrows run along each road at even spacing; zoomed out, cells hold many segments
 * and the field thins to an even grid. Junctions and parallel cycleways never pile
 * up because they share cells.
 */
export function buildFlowField(segments: RawSegment[], wind: Wind, opts: FlowFieldOptions): FlowLine[] {
  const { spacingM, onRoad } = opts;
  if (segments.length === 0 || !(spacingM > 0)) return [];
  const lat0 = segments[0].lat * DEG;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0);
  interface Cand { seg: SegmentInput; raw: RawSegment; alongM: number; crossM: number; d2: number; cx: number; cy: number }
  const cells = new Map<string, Cand>();
  for (const raw of segments) {
    const seg = normalize(raw);
    const L = seg.segmentLengthM;
    // Candidates every half cell so every cell a road crosses gets one; the nearest-to-centre
    // rule then keeps exactly one per cell.
    const n = Math.max(1, Math.round((2 * L) / spacingM));
    // On the road, a wide street gets extra rows one pitch apart on each side of the
    // centreline, as far out as CROSS_FRACTION of the building-to-building width:
    // three to five rows on a boulevard from zoom 17, one row on a 20 m residential
    // canyon until the very last zoom level.
    const rows = onRoad ? Math.floor((CROSS_FRACTION * seg.canyonW) / spacingM) : 0;
    for (let k = 0; k < n; k++) for (let j = -rows; j <= rows; j++) {
      const alongM = ((k + 0.5) / n - 0.5) * L;
      const crossM = j * spacingM;
      const p0 = offsetAlongBearing({ lon: seg.lon, lat: seg.lat }, seg.bearingDeg, alongM);
      const p = crossM === 0 ? p0 : offsetAlongBearing(p0, seg.bearingDeg + 90, crossM);
      const xM = p.lon * mPerDegLon;
      const yM = p.lat * M_PER_DEG_LAT;
      const cx = Math.floor(xM / spacingM);
      const cy = Math.floor(yM / spacingM);
      const dx = xM - (cx + 0.5) * spacingM;
      const dy = yM - (cy + 0.5) * spacingM;
      const d2 = dx * dx + dy * dy;
      const key = cx + ',' + cy;
      const cur = cells.get(key);
      if (!cur || d2 < cur.d2) cells.set(key, { seg, raw, alongM, crossM, d2, cx, cy });
    }
  }
  const travelRad = ((wind.directionDeg + 180) % 360) * DEG;
  const waveX = Math.sin(travelRad), waveY = Math.cos(travelRad);
  const out: FlowLine[] = [];
  const windCache = new Map<RawSegment, ReturnType<typeof computeSegmentCenterWind>>();
  for (const c of cells.values()) {
    let cw = windCache.get(c.raw);
    if (!cw) { cw = computeSegmentCenterWind(c.seg, wind); windCache.set(c.raw, cw); }
    const color = windBandColor(shelterRatio(cw.speedMs, wind.speedMs));
    const sizePx = sizeForSpeed(cw.speedMs);
    // Brightness wave travelling downwind across the whole field (see arrowAlpha):
    // phase is the arrow's position along the ambient wind vector, in wavelengths.
    const xM = (c.cx + 0.5) * spacingM, yM = (c.cy + 0.5) * spacingM;
    const phase = (((xM * waveX + yM * waveY) / (WAVELENGTH_CELLS * spacingM)) % 1 + 1) % 1;
    const lon = onRoad ? c.seg.lon : ((c.cx + 0.5) * spacingM) / mPerDegLon;
    const lat = onRoad ? c.seg.lat : ((c.cy + 0.5) * spacingM) / M_PER_DEG_LAT;
    out.push({
      lon, lat,
      flowDeg: cw.flowDeg, bearingDeg: c.seg.bearingDeg,
      baseAlongM: onRoad ? c.alongM : 0, baseCrossM: onRoad ? c.crossM : 0, color, sizePx, phase,
      speedMs: cw.speedMs, gustMs: cw.gustMs,
      canyonH: c.seg.canyonH, canyonW: c.seg.canyonW,
      leftHeightM: c.seg.leftHeightM, rightHeightM: c.seg.rightHeightM,
      geometrySource: c.seg.geometrySource, wayId: c.raw.wayId,
    });
  }
  return out;
}

function arrowPosition(d: FlowLine): [number, number] {
  // Anchored: on the lattice cell centre when zoomed out, on the road when zoomed in.
  const along = offsetAlongBearing({ lon: d.lon, lat: d.lat }, d.bearingDeg, d.baseAlongM);
  const p = d.baseCrossM === 0 ? along : offsetAlongBearing(along, d.bearingDeg + 90, d.baseCrossM);
  return [p.lon, p.lat];
}

// Arrows never move and never vanish. Direction is animated as a soft brightness wave
// that travels downwind through the lattice; alpha stays within [ALPHA_MIN, 1].
const ALPHA_MIN = 0.7;
function arrowAlpha(d: FlowLine, time: number): number {
  const w = 0.5 + 0.5 * Math.sin(2 * Math.PI * (d.phase - time * RATE));
  return ALPHA_MIN + (1 - ALPHA_MIN) * w;
}

interface FlowLineLayerOpts {
  data: FlowLine[];
  /** Continuously increasing seconds — drives the conveyor. */
  time: number;
  isMobile: boolean;
  onHover?: (info: { object?: FlowLine; x: number; y: number }) => void;
  onClick?: (info: { object?: FlowLine; x: number; y: number }) => boolean;
}

export function createFlowLineLayer({ data, time, isMobile, onHover, onClick }: FlowLineLayerOpts) {
  return new IconLayer<FlowLine>({
    id: 'wind-flow-arrows',
    data,
    getIcon: () => 'arrow',
    iconAtlas: '/arrow.svg',
    iconMapping: { arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true } },
    sizeUnits: 'pixels',
    // Phones are held further from the eye and the arrow is a touch target.
    getSize: (d) => d.sizePx + (isMobile ? 2 : 0),
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
  });
}
