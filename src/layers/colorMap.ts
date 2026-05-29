// src/layers/colorMap.ts
// Maps signed headwind component (m/s) to an RGB color via piecewise linear
// interpolation over a diverging perceptual ramp (ColorBrewer RdYlGn).

export type RGB = [number, number, number];

const STOPS: Array<[number, RGB]> = [
  [-8, [26, 152, 80]],   // deep green: strong tailwind
  [-4, [145, 207, 96]],  // light green
  [0, [200, 200, 200]],  // gray: neutral
  [4, [252, 141, 89]],   // orange
  [8, [215, 48, 39]],    // red
  [12, [103, 0, 31]],    // dark red: punishing headwind
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function headwindColor(headwindMs: number): RGB {
  if (headwindMs <= STOPS[0][0]) return [...STOPS[0][1]];
  const last = STOPS[STOPS.length - 1];
  if (headwindMs >= last[0]) return [...last[1]];

  for (let i = 0; i < STOPS.length - 1; i++) {
    const [v0, c0] = STOPS[i];
    const [v1, c1] = STOPS[i + 1];
    if (headwindMs >= v0 && headwindMs <= v1) {
      const t = (headwindMs - v0) / (v1 - v0);
      return [
        Math.round(lerp(c0[0], c1[0], t)),
        Math.round(lerp(c0[1], c1[1], t)),
        Math.round(lerp(c0[2], c1[2], t)),
      ];
    }
  }

  return [128, 128, 128]; // unreachable
}