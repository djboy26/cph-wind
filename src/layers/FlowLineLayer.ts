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

const ARROWS_PER_STREET = 3;
const STREAM_MIN_M = 16;
const STREAM_MAX_M = 30;
// Stream traversals per second, and the fraction of the stream over which an arrow
// fades in/out at the ends (so the wrap is invisible).
const RATE = 0.3;
const FADE = 0.18;

export interface FlowLine {
  lon: number;
  lat: number;
  /** Compass direction the wind flows TOWARD (arrow points + streams this way). */
  flowDeg: number;
  color: [number, number, number];
  /** Arrow size in metres (bigger = stronger wind). */
  sizeM: number;
  /** Stagger position along the conveyor, 0..1. */
  phase: number;
  /** Half the stream length, metres. */
  streamHalfLen: number;
  // --- carried for the tooltip ---
  speedMs: number;
  gustMs?: number;
  bearingDeg: number;
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

/** A few wind-direction arrows per street, staggered along a downwind conveyor. */
export function buildFlowField(segments: RawSegment[], wind: Wind): FlowLine[] {
  const out: FlowLine[] = [];
  for (const raw of segments) {
    const seg = normalize(raw);
    const cw = computeSegmentCenterWind(seg, wind); // { speedMs, flowDeg, gustMs }
    const color = windBandColor(cw.speedMs);
    const sizeM = sizeForSpeed(cw.speedMs);
    const streamHalfLen = Math.max(STREAM_MIN_M, Math.min(STREAM_MAX_M, seg.segmentLengthM)) / 2;
    for (let k = 0; k < ARROWS_PER_STREET; k++) {
      out.push({
        lon: seg.lon,
        lat: seg.lat,
        flowDeg: cw.flowDeg,
        color,
        sizeM,
        phase: k / ARROWS_PER_STREET,
        streamHalfLen,
        speedMs: cw.speedMs,
        gustMs: cw.gustMs,
        bearingDeg: seg.bearingDeg,
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
  const along = (frac - 0.5) * 2 * d.streamHalfLen; // upwind (−) → downwind (+)
  const p = offsetAlongBearing({ lon: d.lon, lat: d.lat }, d.flowDeg, along);
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
