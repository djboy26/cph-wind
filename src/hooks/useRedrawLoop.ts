// src/hooks/useRedrawLoop.ts
// Keeps one deck.gl layer redrawing at up to `fps` frames a second, outside React.
//
// The arrow layer computes its brightness wave in the vertex shader from a clock it reads
// in draw() (FlowLineLayer.ts, WaveIconLayer), so an animation frame needs nothing from
// React and nothing recomputed per arrow, only deck.gl's redraw flag for that layer.
// Raising the flag (Layer.setNeedsRedraw) instead of calling deck.redraw() lets deck.gl
// fold the wave into the frame it draws anyway while the map moves, so a pan never draws
// twice. requestAnimationFrame pauses in a hidden tab, and the loop with it.
import { useEffect } from 'react';

export interface Redrawable {
  setNeedsRedraw(): void;
}

/**
 * Raise `target`'s redraw flag at most `fps` times a second, on animation frames.
 * Returns the function that stops the loop.
 */
export function startRedrawLoop(target: Redrawable, fps: number): () => void {
  const minInterval = 1000 / fps;
  let last = -Infinity;
  let raf = requestAnimationFrame(function tick(now: number) {
    raf = requestAnimationFrame(tick);
    // 1 ms of slack, so frame-time jitter on a 60 Hz display does not drop a frame at fps 30 or 60.
    if (now - last < minInterval - 1) return;
    last = now;
    target.setNeedsRedraw();
  });
  return () => cancelAnimationFrame(raf);
}

/** The loop as a hook: runs while `enabled` and a target exists, restarts when either changes. */
export function useRedrawLoop(target: Redrawable | undefined, fps: number, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !target) return;
    return startRedrawLoop(target, fps);
  }, [target, fps, enabled]);
}
