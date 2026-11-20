// src/buildings/chunks.ts
// The 3D-buildings file cut into fixed 0.02° chunks (the segment tiles' grid). The map
// keeps one extrusion layer per chunk, so panning builds only the chunks that come into
// view; until sprint 2 every snap of the view re-filtered all 221,812 footprints (23 ms)
// and re-extruded every building in the box. A footprint belongs to the chunk holding its
// first vertex, half-open on each side, so it is in exactly one chunk.

/** One row of the slim buildings file: [heightM, outer ring as [lon, lat] pairs]. */
export type BuildingRow = [number, [number, number][]];

export const CHUNK_DEG = 0.02;

export function chunkKey(cx: number, cy: number): string {
  return `${cx}_${cy}`;
}

/** The chunk a point is in: [column, row] counted from 0° in CHUNK_DEG steps. */
export function chunkOf(lon: number, lat: number): [number, number] {
  return [Math.floor(lon / CHUNK_DEG), Math.floor(lat / CHUNK_DEG)];
}

/** The rows bucketed by chunk, in file order inside each chunk. A row with no vertex is dropped. */
export function bucketBuildings(rows: BuildingRow[]): Map<string, BuildingRow[]> {
  const out = new Map<string, BuildingRow[]>();
  for (const row of rows) {
    const first = row[1]?.[0];
    if (!first) continue;
    const [cx, cy] = chunkOf(first[0], first[1]);
    const key = chunkKey(cx, cy);
    const list = out.get(key);
    if (list) list.push(row); else out.set(key, [row]);
  }
  return out;
}

/** The chunks a box touches, west to east, then south to north. Edges count as inside. */
export function chunkKeysForBox(west: number, south: number, east: number, north: number): string[] {
  const [c0, r0] = chunkOf(west, south);
  const [c1, r1] = chunkOf(east, north);
  const keys: string[] = [];
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) keys.push(chunkKey(c, r));
  return keys;
}
