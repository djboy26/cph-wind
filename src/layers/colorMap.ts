// src/layers/colorMap.ts
// Maps wind magnitude (m/s) to RGB. Calibrated for typical urban wind range (0-8 m/s).
// Gray = sheltered/perpendicular streets. Saturated = wind acting on the street.

export type RGB = [number, number, number];

const STOPS: Array<[number, RGB]> = [
  [0, [200, 200, 200]],     // gray: no along-street wind
  [0.7, [80, 180, 110]],    // green: mild
  [2, [240, 200, 30]],      // yellow: noticeable
  [4, [240, 110, 40]],      // orange: strong
  [8, [215, 35, 50]],       // red: very strong (gale)
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function magnitudeColor(magnitudeMs: number): RGB {
  if (magnitudeMs <= STOPS[0][0]) return [...STOPS[0][1]];
  const last = STOPS[STOPS.length - 1];
  if (magnitudeMs >= last[0]) return [...last[1]];

  for (let i = 0; i < STOPS.length - 1; i++) {
    const [v0, c0] = STOPS[i];
    const [v1, c1] = STOPS[i + 1];
    if (magnitudeMs >= v0 && magnitudeMs <= v1) {
      const t = (magnitudeMs - v0) / (v1 - v0);
      return [
        Math.round(lerp(c0[0], c1[0], t)),
        Math.round(lerp(c0[1], c1[1], t)),
        Math.round(lerp(c0[2], c1[2], t)),
      ];
    }
  }
  return [128, 128, 128];
}