// src/layers/buildWindArrows.ts
// The segment shape the tiles decode into, and the zoom → density rule. Nothing else.
//
// The arrow builder that used to live here drew a second, metre-sized arrow layer
// (WindFlowLayer) that the app never mounted; FlowLineLayer.ts is the one it renders.
// Two arrow layers with two size functions in two units is how step 5 went wrong,
// so this file is deliberately reduced to the three names App.tsx and
// FlowLineLayer.ts import. Do not grow an arrow builder back in here.

import type { SegmentInput } from '../math';

export interface RawSegment extends SegmentInput {
  wayId: string | number | undefined;
  /** Optional carriageway width (metres). Nothing sets it today; kept so the decoded segment shape is unchanged. */
  roadWidthM?: number;
}

/**
 * hidden: below zoom 13, no arrows.
 * single: zoom 13–16, one static arrow per street.
 * multi:  zoom 16 and up, three arrows per street streaming downwind.
 */
export type ArrowDensity = 'hidden' | 'single' | 'multi';

export function arrowDensityForZoom(zoom: number): ArrowDensity {
  if (zoom < 13) return 'hidden';
  if (zoom < 16) return 'single';
  return 'multi';
}
