// src/buildings/buildingsWorker.ts
// The 3D-buildings file off the main thread. JSON.parse of the 42 MB file took ~0.9 s on
// the main thread, a freeze on the first zoom past 14; here it costs the map nothing.
// The worker keeps the footprints bucketed by chunk (chunks.ts) and posts one chunk at
// a time, a few thousand rows at most.

import { bucketBuildings, type BuildingRow } from './chunks';

interface LoadMsg { type: 'load'; url: string }
interface ChunkMsg { type: 'chunk'; id: number; key: string }
export type InMsg = LoadMsg | ChunkMsg;
export type OutMsg =
  | { type: 'chunk'; id: number; rows: BuildingRow[] }
  | { type: 'error'; message: string };

const post = (m: OutMsg) => (self as unknown as Worker).postMessage(m);
let chunks: Promise<Map<string, BuildingRow[]>> | null = null;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    if (chunks) return;
    chunks = fetch(msg.url)
      .then((r) => { if (!r.ok) throw new Error(`Buildings ${r.status}`); return r.json() as Promise<BuildingRow[]>; })
      .then(bucketBuildings);
    chunks.catch((err: unknown) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  if (msg.type === 'chunk' && chunks) {
    chunks.then((m) => post({ type: 'chunk', id: msg.id, rows: m.get(msg.key) ?? [] }), () => { /* reported once above */ });
  }
};
