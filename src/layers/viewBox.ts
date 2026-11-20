// src/layers/viewBox.ts
// The box the arrows, the segment tiles and the buildings cover: the visible area plus a
// margin, snapped so it stays the same while the view moves a little. Everything built
// from it (the field, about 30 ms at the city view) is rebuilt only when it changes.
//
// Per axis, the box's centre snaps to a cell near a quarter of the view (a power-of-two
// multiple of SNAP_DEG, so the cells nest across zooms), and its half-size is the view's
// half-size, plus PAD of the view, plus half a cell. So the view is always inside with at
// least PAD of it to spare, the box is about 1.5 views across, and a pan changes it about
// every quarter screen at any zoom. Until sprint 2 the box's edges snapped to a fixed
// 0.004° grid, 66 px at the desktop city view: a rebuild every 66 px of pan.
//
// A pure function of the visible area, so a view gets the same box, and the same arrows,
// whatever the path to it.

export const SNAP_DEG = 0.004;
/** The margin on each side, as a share of the view. */
export const PAD = 0.125;
/**
 * The widest view the field covers in full (a steep pitch stretches the visible area
 * toward the horizon; past this the outer edges go without arrows). The box itself is
 * at most this plus one snap cell, so it always holds the MAX_SPAN_DEG window centred on
 * the view, wherever its own snapped centre falls.
 */
export const MAX_SPAN_DEG = 0.12;
/** Half-sizes are whole multiples of this, so the box is never more than 0.001° looser than needed. */
const HALF_STEP_DEG = SNAP_DEG / 4;

/** The largest snap cell. A bigger one would widen the box at the desktop city view (see MAX_SPAN_DEG) more than it saves. */
export const MAX_CELL_DEG = 4 * SNAP_DEG;

/** The snap cell for a view this many degrees across: the power-of-two multiple of SNAP_DEG nearest a quarter of it, at most MAX_CELL_DEG. */
export function snapDegFor(spanDeg: number): number {
  return Math.min(MAX_CELL_DEG, SNAP_DEG * 2 ** Math.max(0, Math.round(Math.log2((spanDeg * 0.25) / SNAP_DEG))));
}

function axis(lo: number, hi: number): [number, number] {
  const span = Math.min(hi - lo, MAX_SPAN_DEG);
  const cell = snapDegFor(span);
  const mid = Math.round((lo + hi) / 2 / cell) * cell;
  const half = Math.min(MAX_SPAN_DEG / 2 + cell / 2, Math.ceil((span / 2 + span * PAD + cell / 2) / HALF_STEP_DEG - 1e-9) * HALF_STEP_DEG);
  return [mid - half, mid + half];
}

/** The box for a visible area [west, south, east, north], as [west, south, east, north]. */
export function boxForBounds([west, south, east, north]: readonly [number, number, number, number]): [number, number, number, number] {
  const [w, e] = axis(west, east);
  const [s, n] = axis(south, north);
  return [w, s, e, n];
}

/** The box as a stable string key: equal boxes give equal keys. */
export function boxKey(box: readonly [number, number, number, number]): string {
  return box.map((v) => v.toFixed(4)).join(",");
}
