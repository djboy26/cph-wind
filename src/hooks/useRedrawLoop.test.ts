// src/hooks/useRedrawLoop.test.ts
// The wave's frame clock: how often it raises the arrow layer's redraw flag on displays
// of different refresh rates, and that stopping it stops it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRedrawLoop } from './useRedrawLoop';

let queue: Map<number, FrameRequestCallback>;
let nextId = 0;

beforeEach(() => {
  queue = new Map();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.set(++nextId, cb); return nextId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
});
afterEach(() => vi.unstubAllGlobals());

/** Run `frames` animation frames of a `hz` display starting at t0 ms; returns how many raised the flag. */
function run(hz: number, fps: number, frames: number, t0 = 1000) {
  const target = { setNeedsRedraw: vi.fn() };
  const stop = startRedrawLoop(target, fps);
  for (let k = 0; k < frames; k++) {
    const pending = [...queue.values()];
    queue.clear();
    for (const cb of pending) cb(t0 + (k * 1000) / hz);
  }
  return { count: target.setNeedsRedraw.mock.calls.length, stop, target };
}

describe('startRedrawLoop', () => {
  it('60 Hz display: every frame at fps 60, every other frame at fps 30', () => {
    expect(run(60, 60, 120).count).toBe(120);
    expect(run(60, 30, 120).count).toBe(60);
  });

  it('120 Hz display (ProMotion phones): 60 and 30 redraws a second, not 120', () => {
    expect(run(120, 60, 240).count).toBe(120);
    expect(run(120, 30, 240).count).toBe(60);
  });

  it('half a millisecond of frame jitter on a 60 Hz display drops no frame at fps 30', () => {
    const target = { setNeedsRedraw: vi.fn() };
    startRedrawLoop(target, 30);
    let t = 1000;
    for (let k = 0; k < 120; k++) {
      const pending = [...queue.values()];
      queue.clear();
      for (const cb of pending) cb(t);
      t += 1000 / 60 + (k % 2 ? 0.5 : -0.5);
    }
    expect(target.setNeedsRedraw.mock.calls.length).toBe(60);
  });

  it('stop() cancels the pending frame, so nothing fires after it', () => {
    const { stop, target } = run(60, 60, 10);
    const before = target.setNeedsRedraw.mock.calls.length;
    stop();
    expect(queue.size).toBe(0);
    expect(target.setNeedsRedraw.mock.calls.length).toBe(before);
  });
});
