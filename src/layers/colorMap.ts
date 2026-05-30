// src/layers/colorMap.ts
export type RGB = [number, number, number];

const STOPS: Array<[number, RGB]> = [
  [0, [180, 180, 180]],     // gray: street is perpendicular to wind, no along-street effect
  [1.5, [60, 180, 100]],    // saturated green: mild along-street component
  [4, [240, 200, 30]],      // yellow: moderate
  [7, [240, 110, 40]],      // orange: strong
  [11, [215, 35, 50]],      // red: very strong
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
