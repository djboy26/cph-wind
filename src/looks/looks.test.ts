import { describe, expect, it } from 'vitest';
import { contrast, oklabL, type RGB } from './oklch';
import { LOOKS, LOOK_IDS, lookFromHash, applyLookToDocument } from './looks';

const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const rgba = (s: string): [RGB, number] => {
  if (s.startsWith('#')) return [hex(s), 1];
  const [r, g, b, a = '1'] = s.replace(/rgba?\(|\)/g, '').split(',').map((x) => x.trim());
  return [[+r, +g, +b], +a];
};
/** A translucent panel over the land, as the eye sees it. */
const over = (fg: string, bg: string): RGB => {
  const [c, a] = rgba(fg), [d] = rgba(bg);
  return c.map((v, i) => Math.round(a * v + (1 - a) * d[i])) as RGB;
};

describe('looks', () => {
  it('every look has six arrow colours and all the panel variables Morning has', () => {
    const keys = Object.keys(LOOKS.morning.ui).sort();
    for (const id of LOOK_IDS) {
      expect(LOOKS[id].bands).toHaveLength(6);
      expect(Object.keys(LOOKS[id].ui).sort()).toEqual(keys);
    }
  });

  it('keeps the shelter bands in order of lightness (Ink: the five greys; its sixth is red)', () => {
    for (const id of LOOK_IDS.filter((x) => x !== 'harbour')) {
      const bands = id === 'ink' ? LOOKS[id].bands.slice(0, 5) : LOOKS[id].bands;
      const L = bands.map(oklabL);
      const dir = Math.sign(L[L.length - 1] - L[0]);
      for (let i = 1; i < L.length; i++) expect(Math.sign(L[i] - L[i - 1]), `${id} band ${i}`).toBe(dir);
      // Neighbours at least 0.04 apart in OKLab L (a just-visible step is ~0.02).
      for (let i = 1; i < L.length; i++) expect(Math.abs(L[i] - L[i - 1]), `${id} band ${i}`).toBeGreaterThan(0.04);
    }
  });

  it('Harbour diverges around Open: lightness rises to Open (band 4) and falls after it', () => {
    const L = LOOKS.harbour.bands.map(oklabL);
    for (let i = 1; i <= 3; i++) expect(L[i] - L[i - 1], `rise ${i}`).toBeGreaterThan(0.04);
    for (let i = 4; i <= 5; i++) expect(L[i - 1] - L[i], `fall ${i}`).toBeGreaterThan(0.04);
    // and the two sides are told apart by hue: teal (b < 0 side) against red (a > 0)
    const [t, , , , , r] = LOOKS.harbour.bands;
    expect(t[2]).toBeGreaterThan(t[0]); // teal: more blue than red
    expect(r[0]).toBeGreaterThan(r[2]); // brick: more red than blue
  });

  it('Ink sets its red apart from every grey by at least 0.15 in OKLab L or by hue', () => {
    const [r, g, b] = LOOKS.ink.bands[5];
    expect(r - Math.max(g, b)).toBeGreaterThan(80); // a chromatic red among neutral greys
  });

  it('panel text and secondary text clear WCAG 4.5:1 on the panel over the land, in every look', () => {
    for (const id of LOOK_IDS) {
      const { ui, map } = LOOKS[id];
      const panel = over(ui['--c-panel'], map.land);
      expect(contrast(hex(ui['--c-text']), panel), `${id} text`).toBeGreaterThan(4.5);
      expect(contrast(hex(ui['--c-dim']), panel), `${id} dim`).toBeGreaterThan(4.5);
    }
  });

  it('reads the look from the URL hash, defaulting to Morning', () => {
    expect(lookFromHash('#look=night').id).toBe('night');
    expect(lookFromHash('#z=16&look=ink&lat=55.6').id).toBe('ink');
    expect(lookFromHash('#look=nope').id).toBe('morning');
    expect(lookFromHash('').id).toBe('morning');
  });

  it('writes its panel variables onto the page', () => {
    const el = document.createElement('div');
    applyLookToDocument(LOOKS.night, el);
    expect(el.style.getPropertyValue('--c-text')).toBe('#e9eef4');
    expect(el.dataset.look).toBe('night');
  });
});
