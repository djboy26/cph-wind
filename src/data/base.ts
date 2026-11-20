// src/data/base.ts
// Every map-data URL the app fetches is built here. The files are served from the app's own
// origin under /data/, put there at build time from the version pinned in data.lock.json
// (npm run data:pull, run by `npm run build`). Serving them straight from object storage
// later (the world milestone) changes this one function, not the call sites.
export const DATA_BASE = '/data';

/** URL of a map-data file, given its path under public/data, e.g. "segtiles/index.json". */
export function dataUrl(path: string): string {
  return `${DATA_BASE}/${path.replace(/^\/+/, '')}`;
}
