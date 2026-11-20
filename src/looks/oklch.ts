// src/looks/oklch.ts
// OKLCH → sRGB (8-bit), for designing colour ramps whose lightness steps are even to the
// eye. OKLab is Björn Ottosson's perceptual space (2020): L is perceived lightness 0..1,
// C chroma, h hue in degrees. Matrices from https://bottosson.github.io/posts/oklab/.
// Out-of-gamut colours are brought in by reducing chroma at fixed L and h (binary search),
// so a ramp keeps its lightness steps even where sRGB cannot show the full chroma.

export type RGB = [number, number, number];

function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

function linearAt(L: number, C: number, hDeg: number) {
  const h = (hDeg * Math.PI) / 180;
  return oklabToLinear(L, C * Math.cos(h), C * Math.sin(h));
}

/** sRGB 0..255 for an OKLCH colour, chroma reduced into the sRGB gamut if needed. */
export function oklchToRgb(L: number, C: number, hDeg: number): RGB {
  let lin = linearAt(L, C, hDeg);
  if (!inGamut(lin)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(linearAt(L, mid, hDeg))) lo = mid; else hi = mid;
    }
    lin = linearAt(L, lo, hDeg);
  }
  return lin.map((v) => Math.round(255 * encode(Math.min(1, Math.max(0, v))))) as RGB;
}

/** OKLab lightness L (0..1) of an 8-bit sRGB colour. */
export function oklabL([r, g, b]: RGB): number {
  const lin = [r, g, b].map((c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  const l = 0.4122214708 * lin[0] + 0.5363325363 * lin[1] + 0.0514459929 * lin[2];
  const m = 0.2119034982 * lin[0] + 0.6806995451 * lin[1] + 0.1073969566 * lin[2];
  const s = 0.0883024619 * lin[0] + 0.2817188376 * lin[1] + 0.6299787005 * lin[2];
  return 0.2104542553 * Math.cbrt(l) + 0.793617785 * Math.cbrt(m) - 0.0040720468 * Math.cbrt(s);
}

/** WCAG 2.x contrast ratio between two 8-bit sRGB colours (1 to 21). */
export function contrast(a: RGB, b: RGB): number {
  const lum = ([r, g, bl]: RGB) => {
    const f = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `n` colours stepping evenly from (L0, C0, h0) to (L1, C1, h1) in OKLCH; hue takes the short way round. */
export function ramp(n: number, [L0, C0, h0]: [number, number, number], [L1, C1, h1]: [number, number, number]): RGB[] {
  let dh = ((h1 - h0 + 540) % 360) - 180;
  if (Math.abs(dh) < 1e-9) dh = 0;
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1);
    return oklchToRgb(L0 + (L1 - L0) * t, C0 + (C1 - C0) * t, h0 + dh * t);
  });
}
