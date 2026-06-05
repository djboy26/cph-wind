// src/layers/FlowLineLayer.ts
// Wind shown as a field of arrows. Each street gets a few arrows that POINT in the
// local wind direction (the 3D-canyon-modified flowDeg), are SIZED by wind strength,
// coloured by the cyclist speed band, and STREAM downwind in a short conveyor. The
// conveyor uses several staggered arrows per street so the street is always
// populated — arrows fade only at the wrap point, masked by their neighbours, so
// nothing visibly "disappears".

import { IconLayer } from '@deck.gl/layers';
import {
  computeSegmentCenterWind,
  offsetAlongBearing,
  type GeometrySource,
  type SegmentInput,
  type Wind,
} from '../math';
import { windBandColor } from '../cyclist/windCategory';
import type { RawSegment } from './buildWindArrows';

const DEG = Math.PI / 180;
const ARROWS_PER_STREET = 3;
// How far along the street the arrows are spread (capped), and the max lateral
// excursion off the centerline. Together they confine every arrow to the road
// while it drifts in the TRUE wind direction.
const SPREAD_MAX_M = 40;
const CROSS_MARGIN_M = 3;
const RATE = 0.45;
const FADE = 0.18;

// Max drift (m) along flowDeg before the particle would leave its on-road cell:
// lots of travel when the wind runs along the street, very little across it. This
// is what keeps arrows coherent (they move the way they point) AND on the road.
function boundedTravel(flowDeg: number, bearingDeg: number, alongCellM: number): number {
  const rel = (flowDeg - bearingDeg) * DEG;
  const along = Math.abs(Math.cos(rel));
  const cross = Math.abs(Math.sin(rel));
  const byAlong = alongCellM / Math.max(along, 1e-3);
  const byCross = (2 * CROSS_MARGIN_M) / Math.max(cross, 1e-3);
  return Math.max(0, Math.min(byAlong, byCross, alongCellM * 1.5));
}

export interface FlowLine {
  lon: number;
  lat: number;
  /** Compass direction the wind flows TOWARD — the arrow points AND drifts this way. */
  flowDeg: number;
  /** Street axis (deg CW from N) — used to place arrows along the centerline. */
  bearingDeg: number;
  /** Fixed offset along the street (m) for this arrow, spreading them down the road. */
  baseAlongM: number;
  /** Max drift (m) in flowDeg — bounded by the road so the arrow stays on it. */
  travelLenM: number;
  color: [number, number, number];
  /** Arrow size in metres (bigger = stronger wind). */
  sizeM: number;
  /** Stagger position along the conveyor, 0..1. */
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

// Bolder arrow for stronger wind (metres; clamped so it stays readable).
function sizeForSpeed(speedMs: number): number {
  return Math.max(3, Math.min(9.5, 2.6 + speedMs * 0.95));
}

/** Wind-direction arrows spread along each street; each drifts (bounded) in flowDeg. */
export function buildFlowField(segments: RawSegment[], wind: Wind): FlowLine[] {
  const out: FlowLine[] = [];
  for (const raw of segments) {
    const seg = normalize(raw);
    const cw = computeSegmentCenterWind(seg, wind); // { speedMs, flowDeg, gustMs }
    const color = windBandColor(cw.speedMs);
    const sizeM = sizeForSpeed(cw.speedMs);
    // Spread the arrows along the street centerline, each within its own slot.
    const spread = Math.min(seg.segmentLengthM, SPREAD_MAX_M);
    const alongCell = spread / ARROWS_PER_STREET;
    const travelLenM = boundedTravel(cw.flowDeg, seg.bearingDeg, alongCell);
    for (let k = 0; k < ARROWS_PER_STREET; k++) {
      const baseAlongM = ((k + 0.5) / ARROWS_PER_STREET - 0.5) * spread;
      out.push({
        lon: seg.lon,
        lat: seg.lat,
        flowDeg: cw.flowDeg,
        bearingDeg: seg.bearingDeg,
        baseAlongM,
        travelLenM,
        color,
        sizeM,
        phase: k / ARROWS_PER_STREET,
        speedMs: cw.speedMs,
        gustMs: cw.gustMs,
        canyonH: seg.canyonH,
        canyonW: seg.canyonW,
        leftHeightM: seg.leftHeightM,
        rightHeightM: seg.rightHeightM,
        geometrySource: seg.geometrySource,
        wayId: raw.wayId,
      });
    }
  }
  return out;
}

function fracOf(d: FlowLine, time: number): number {
  return (((d.phase + time * RATE) % 1) + 1) % 1;
}

function arrowPosition(d: FlowLine, time: number): [number, number] {
  const frac = fracOf(d, time);
  // Anchor on the street centerline, then drift in the TRUE wind direction (flowDeg)
  // — the arrow moves the way it points. travelLenM is bounded by the road, so the
  // cross-street excursion can't leave the carriageway.
  const anchor = offsetAlongBearing({ lon: d.lon, lat: d.lat }, d.bearingDeg, d.baseAlongM);
  const drift = (frac - 0.5) * d.travelLenM;
  const p = offsetAlongBearing(anchor, d.flowDeg, drift);
  return [p.lon, p.lat];
}

function arrowAlpha(d: FlowLine, time: number): number {
  const frac = fracOf(d, time);
  // Full in the middle, fading to 0 only in the outer FADE band at each end.
  const t = Math.min(frac, 1 - frac) / FADE;
  return Math.max(0, Math.min(1, t));
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
    sizeUnits: 'meters',
    getSize: (d) => d.sizeM,
    sizeMinPixels: isMobile ? 8 : 6,
    sizeMaxPixels: 28,
    getPosition: (d) => arrowPosition(d, time),
    getAngle: (d) => 90 - d.flowDeg,
    getColor: (d) => {
      const a = arrowAlpha(d, time);
      return [d.color[0], d.color[1], d.color[2], Math.round(255 * a)];
    },
    pickable: true,
    billboard: false,
    onHover,
    onClick,
    updateTriggers: { getPosition: time, getColor: time },
  });
}
