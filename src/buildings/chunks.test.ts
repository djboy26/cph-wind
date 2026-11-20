import { describe, expect, it } from 'vitest';
import { bucketBuildings, chunkKeysForBox, chunkOf, CHUNK_DEG, type BuildingRow } from './chunks';

// A deterministic spread of footprints over Copenhagen (12.34–12.78 E, 55.54–55.82 N),
// some exactly on chunk edges, where a half-open rule matters.
function rows(n: number): BuildingRow[] {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out: BuildingRow[] = [];
  for (let i = 0; i < n; i++) {
    const onEdge = i % 50 === 0;
    const lon = onEdge ? 12.4 + CHUNK_DEG * Math.floor(rnd() * 10) : 12.34 + rnd() * 0.44;
    const lat = onEdge ? 55.6 + CHUNK_DEG * Math.floor(rnd() * 5) : 55.54 + rnd() * 0.28;
    out.push([5 + i % 30, [[lon, lat], [lon + 1e-4, lat], [lon + 1e-4, lat + 1e-4], [lon, lat]]]);
  }
  return out;
}

describe('bucketBuildings', () => {
  it('puts every footprint in exactly one chunk, the one holding its first vertex', () => {
    const all = rows(5000);
    const buckets = bucketBuildings(all);
    const seen = new Set<BuildingRow>();
    for (const [key, list] of buckets) {
      for (const r of list) {
        expect(seen.has(r)).toBe(false);
        seen.add(r);
        const [cx, cy] = chunkOf(r[1][0][0], r[1][0][1]);
        expect(`${cx}_${cy}`).toBe(key);
      }
    }
    expect(seen.size).toBe(all.length);
  });

  it('keeps file order inside a chunk (the draw order of overlapping walls)', () => {
    const all = rows(5000);
    const index = new Map(all.map((r, i) => [r, i]));
    for (const list of bucketBuildings(all).values()) {
      const idx = list.map((r) => index.get(r)!);
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
  });

  it('drops a row with no vertex instead of throwing', () => {
    const bad = [[4, []] as unknown as BuildingRow, ...rows(3)];
    let n = 0;
    for (const list of bucketBuildings(bad).values()) n += list.length;
    expect(n).toBe(3);
  });
});

describe('chunkKeysForBox', () => {
  it('covers every footprint whose first vertex is inside the box', () => {
    const all = rows(5000);
    const buckets = bucketBuildings(all);
    const box = [12.5512, 55.6612, 12.6188, 55.6996] as const;
    const keys = new Set(chunkKeysForBox(...box));
    for (const r of all) {
      const [lon, lat] = r[1][0];
      if (lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3]) {
        const [cx, cy] = chunkOf(lon, lat);
        expect(keys.has(`${cx}_${cy}`)).toBe(true);
        expect(buckets.get(`${cx}_${cy}`)).toContain(r);
      }
    }
  });

  it('is one chunk for a box inside one chunk, and grows a column per chunk edge crossed', () => {
    expect(chunkKeysForBox(12.561, 55.661, 12.569, 55.669)).toHaveLength(1);
    expect(chunkKeysForBox(12.561, 55.661, 12.581, 55.669)).toHaveLength(2);
    expect(chunkKeysForBox(12.561, 55.661, 12.581, 55.681)).toHaveLength(4);
  });
});
