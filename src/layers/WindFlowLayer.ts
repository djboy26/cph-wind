// src/layers/WindFlowLayer.ts
// Wind-vector arrows confined to the street carriageway.
//
// Each arrow is a particle anchored to a fixed grid point on the roadway. It
// points in and drifts along the TRUE local wind vector (the 3D-canyon-modified
// direction), but its travel is bounded so it can never leave its cell — and the
// cells tile only the carriageway, so nothing bleeds onto sidewalks or buildings.
// Opacity fades in/out across the travel so the bounded loop reads as continuous
// flow with no visible reset, like a particle wind map.

import { IconLayer } from '@deck.gl/layers';
import { offsetAlongBearing, offsetLonLat, type LonLat } from '../math';
import type { GeometrySource } from '../math';

export interface WindArrowInstance {
  segmentId: number;
  wayId: string | number | undefined;
  /** Segment midpoint — anchor for the grid offsets. */
  lon: number;
  lat: number;
  /** Street axis, deg CW from north (defines the carriageway grid). */
  bearingDeg: number;
  /** Fixed lateral grid offset from the centerline, meters (within the carriageway). */
  offsetM: number;
  /** Fixed along-street grid offset from the midpoint, meters. */
  baseAlongM: number;
  /** True local wind flow direction, deg CW from north (glyph + drift direction). */
  flowDeg: number;
  /** Max drift distance along flowDeg, meters — bounded to keep the particle on-road. */
  travelLenM: number;
  /** Per-particle phase offset (0..1) so the grid does not pulse in unison. */
  phase0: number;
  /** Animation rate multiplier for the MEAN wind (stronger wind drifts faster). */
  speedFactor: number;
  /** Rendered arrow length, meters (≈ 1/5 of carriageway width). */
  arrowSizeM: number;
  /** Local mean wind speed, m/s (drives color). */
  speedMs: number;
  /** Canyon-scaled gust speed, m/s (undefined if no gust reported). */
  gustMs?: number;
  /** Gust amplitude = gust/mean − 1, clamped to [0, 0.9]. 0 ⇒ steady flow. */
  gustBoost: number;
  /** Phase seed (cycles) for the gust oscillation; offset along-street so gusts sweep. */
  gustSeed: number;
  color: [number, number, number];

  // --- carried through for the tooltip ---
  laneIndex: number;
  laneCount: number;
  widthM: number;
  leftHeightM: number;
  rightHeightM: number;
  leftDistM: number;
  rightDistM: number;
  canyonH: number;
  canyonW: number;
  geometrySource: GeometrySource;
}

// One full travel loop per BASE_RATE seconds at speedFactor 1.
const BASE_RATE = 0.5;

// Gusts. A gust cycle lasts ~GUST_PERIOD_S; particles surge faster and lengthen
// near the gust peak and ease through the lull. The seed is offset along the
// street (in buildWindArrows) so a gust front visibly sweeps down the road.
const GUST_PERIOD_S = 11;
const GUST_FREQ = 1 / GUST_PERIOD_S;
const TWO_PI = Math.PI * 2;

// Instantaneous gust phase term in [-1, 1]; +1 at a gust peak, -1 in a lull.
function gustSin(d: WindArrowInstance, flowPhase: number): number {
  return Math.sin(TWO_PI * (GUST_FREQ * flowPhase - d.gustSeed));
}

export interface WindFlowLayerProps {
  data: WindArrowInstance[];
  /** Continuously increasing seconds (not wrapped) for smooth per-arrow drift. */
  flowPhase: number;
  onHover?: (info: { object?: WindArrowInstance; x: number; y: number }) => void;
  onClick?: (info: { object?: WindArrowInstance; x: number; y: number }) => boolean;
}

// Position in the bounded drift loop, [0, 1). The instantaneous drift rate is
// speedFactor·(1 + gustBoost·sin), so the phase is the integral of that rate —
// a closed-form warp that stays strictly increasing (gustBoost ≤ 0.9 < 1), so the
// loop never stalls or reverses. Particles measurably accelerate in gusts and
// ease in lulls, instead of drifting at a constant rate.
function cycleOf(d: WindArrowInstance, flowPhase: number): number {
  let warped = flowPhase;
  if (d.gustBoost > 0) {
    const w = TWO_PI * GUST_FREQ;
    warped =
      flowPhase -
      (d.gustBoost / w) *
        (Math.cos(TWO_PI * (GUST_FREQ * flowPhase - d.gustSeed)) -
          Math.cos(TWO_PI * -d.gustSeed));
  }
  return (((warped * BASE_RATE * d.speedFactor + d.phase0) % 1) + 1) % 1;
}

function arrowPosition(d: WindArrowInstance, flowPhase: number): [number, number] {
  const mid: LonLat = { lon: d.lon, lat: d.lat };
  // Fixed grid point on the carriageway.
  const lateral = offsetLonLat(mid, d.bearingDeg, d.offsetM);
  const grid = offsetAlongBearing(lateral, d.bearingDeg, d.baseAlongM);
  // Bounded drift along the true wind direction (never exceeds travelLenM).
  const cycle = cycleOf(d, flowPhase);
  const drift = (cycle - 0.5) * d.travelLenM;
  const pos = offsetAlongBearing(grid, d.flowDeg, drift);
  return [pos.lon, pos.lat];
}

function arrowColor(d: WindArrowInstance, flowPhase: number): [number, number, number, number] {
  const cycle = cycleOf(d, flowPhase);
  // Triangular fade: invisible at the cell edges, full in the middle → hides the reset.
  let alpha = Math.sin(Math.PI * cycle) * 235 + 20;
  // Gust glow: brighten on the surge (positive half of the gust cycle only).
  if (d.gustBoost > 0) {
    alpha *= 1 + 0.35 * d.gustBoost * Math.max(0, gustSin(d, flowPhase));
  }
  return [d.color[0], d.color[1], d.color[2], Math.min(255, Math.round(alpha))];
}

// Arrow length surges toward the gust speed near a gust peak, shrinks in the lull.
function arrowSize(d: WindArrowInstance, flowPhase: number): number {
  if (d.gustBoost <= 0) return d.arrowSizeM;
  return d.arrowSizeM * (1 + 0.5 * d.gustBoost * gustSin(d, flowPhase));
}

export function createWindFlowLayer(props: WindFlowLayerProps) {
  const { data, flowPhase, onHover, onClick } = props;

  return new IconLayer<WindArrowInstance>({
    id: 'wind-flow',
    data,
    getIcon: () => 'arrow',
    iconAtlas: '/arrow.svg',
    iconMapping: {
      arrow: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true },
    },
    sizeUnits: 'meters',
    getSize: (d) => arrowSize(d, flowPhase),
    sizeMinPixels: 4,
    sizeMaxPixels: 22,
    getPosition: (d) => arrowPosition(d, flowPhase),
    getAngle: (d) => 90 - d.flowDeg,
    getColor: (d) => arrowColor(d, flowPhase),
    pickable: true,
    billboard: false,
    updateTriggers: {
      getPosition: flowPhase,
      getColor: flowPhase,
      getSize: flowPhase,
    },
    onHover,
    onClick,
  });
}
