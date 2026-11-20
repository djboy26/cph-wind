// src/data/base.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dataUrl } from './base';

describe('dataUrl', () => {
  it('serves map data from the app origin under /data/', () => {
    expect(dataUrl('segtiles/index.json')).toBe('/data/segtiles/index.json');
    expect(dataUrl('/cph-roads.json')).toBe('/data/cph-roads.json');
  });

  it('every file the app fetches is pinned in data.lock.json', () => {
    const lock = JSON.parse(readFileSync('data.lock.json', 'utf8')) as { files: Record<string, unknown> };
    for (const p of ['segtiles/index.json', 'cph-roads.json', 'canyon-by-way.json', 'cph-buildings-slim.json']) {
      expect(lock.files[`public${dataUrl(p)}`], p).toBeDefined();
    }
  });
});
