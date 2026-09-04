// src/layers/FlowLineLayer.ts
// Wind shown as a field of arrows. Each street gets arrows that POINT in the local
// wind direction (the 3D-canyon-modified flowDeg), are SIZED by absolute wind
// strength, COLOURED by shelter, and — at 'multi' density — STREAM downwind in a
// short conveyor. The conveyor uses several staggered arrows per street so the
// street is always populated: arrows fade only at the wrap point, masked by their
// neighbours, so nothing visibly "disappears". At 'single' density there is no
// neighbour to do the masking, so the field is static instead.

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
  /** Arrow size in PIXELS (bigger = stronger wind) — the same at every zoom. */
  sizePx: number;
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
// Pixels, not metres. A data glyph should encode the same value the same way at
// every zoom; only a metre-sized glyph needs a zoom-dependent pixel clamp, and that
// clamp is what flattened this channel before. 8 px is the smallest size at which
// the arrowhead still resolves on a light ground; 22 px is where arrows start to
// overlap at 'multi' density. Rendered: 1.1 m/s → 10.4 px, 3.17 → 15.0, 5 → 19,
// ≥ 6.4 → 22.
function sizeForSpeed(speedMs: number): number {
  return Math.max(8, Math.min(22, 8 + speedMs * 2.2));
}

/**
 * Wind-direction arrows spread along each street; each drifts (bounded) in flowDeg.
 *
 * `arrowsPerStreet` is the zoom density rule: 3 from zoom 16 up ('multi'), 1 below
 * it ('single'). At one arrow per street there is no neighbour to mask the conveyor's
 * wrap-around fade — with FADE = 0.18 a third of the field would be half-transparent
 * at any instant and read as arrows randomly missing — so the single-arrow field is
 * static: travelLenM is 0 and arrowAlpha() treats 0 as "always fully drawn". The
 * animation is a zoom-16-and-up feature.
 */
export function buildFlowField(
  segments: RawSegment[],
  wind: Wind,
  arrowsPerStreet = ARROWS_PER_STREET,
): FlowLine[] {
  const out: FlowLine[] = [];
  for (const raw of segments) {
    const seg = normalize(raw);
    const cw = computeSegmentCenterWind(seg, wind); // { speedMs, flowDeg, gustMs }
    // Colour is shelter (street / ambient), not absolute speed — see windCategory.
    const color = windBandColor(shelterRatio(cw.speedMs, wind.speedMs));
    const sizePx = sizeForSpeed(cw.speedMs);
    // Spread the arrows along the street centerline, each within its own slot.
    const spread = Math.min(seg.segmentLengthM, SPREAD_MAX_M);
    const alongCell = spread / arrowsPerStreet;
    const travelLenM = arrowsPerStreet <= 1 ? 0 : boundedTravel(cw.flowDeg, seg.bearingDeg, alongCell);
    for (let k = 0; k < arrowsPerStreet; k++) {
      const baseAlongM = ((k + 0.5) / arrowsPerStreet - 0.5) * spread;
      out.push({
        lon: seg.lon,
        lat: seg.lat,
        flowDeg: cw.flowDeg,
        bearingDeg: seg.bearingDeg,
        baseAlongM,
        travelLenM,
        color,
        sizePx,
        phase: k / arrowsPerStreet,
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
  // A static arrow (single density) has no wrap point to fade at.
  if (d.travelLenM === 0) return 1;
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
    sizeUnits: 'pixels',
    // Phones are held further from the eye and the arrow is a touch target.
    getSize: (d) => d.sizePx + (isMobile ? 2 : 0),
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
