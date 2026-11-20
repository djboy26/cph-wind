// src/buildings/client.ts
// The map's side of buildingsWorker: start it once, ask for chunks by key. A failed load
// rejects every pending and later request, so the caller can drop the client and retry.

import type { BuildingRow } from './chunks';
import type { InMsg, OutMsg } from './buildingsWorker';

export interface BuildingsClient {
  chunk(key: string): Promise<BuildingRow[]>;
  terminate(): void;
}

export function createBuildingsClient(url: string): BuildingsClient {
  const worker = new Worker(new URL('./buildingsWorker.ts', import.meta.url), { type: 'module' });
  const pending = new Map<number, { resolve: (rows: BuildingRow[]) => void; reject: (e: Error) => void }>();
  let next = 0;
  let failed: Error | null = null;
  const fail = (e: Error) => {
    failed = failed ?? e;
    for (const p of pending.values()) p.reject(failed);
    pending.clear();
  };
  const send = (m: InMsg) => worker.postMessage(m);
  worker.onmessage = (e: MessageEvent<OutMsg>) => {
    const m = e.data;
    if (m.type === 'error') { fail(new Error(m.message)); return; }
    pending.get(m.id)?.resolve(m.rows);
    pending.delete(m.id);
  };
  worker.onerror = (e) => fail(new Error(e.message || 'buildings worker failed'));
  send({ type: 'load', url });
  return {
    chunk(key) {
      if (failed) return Promise.reject(failed);
      const id = ++next;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: 'chunk', id, key });
      });
    },
    terminate() {
      worker.terminate();
      fail(new Error('buildings worker stopped'));
    },
  };
}
