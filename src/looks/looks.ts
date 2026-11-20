// src/looks/looks.ts
// The app's looks: one object per look carries every colour the map, the arrows and the
// panels use, so a look is switched in one place (`#look=night` in the URL).
//
// What each look must keep, whatever its style (tested in looks.test.ts):
// - the six shelter bands keep an order of lightness, so the arrows read as a scale for
//   colour-blind riders too: one way for a sequential look; for Harbour, which diverges
//   around "Open", outward from Open on each side; Ink's last band is a red that stands
//   out by chroma against five greys;
// - panel text and secondary text clear WCAG 4.5:1 on the panel, composited over the land.
//
// Ramps are designed in OKLCH (oklch.ts), where equal steps in L look equal.

import type maplibregl from "maplibre-gl";
import { oklchToRgb, ramp, type RGB } from "./oklch";

export type RGBA = [number, number, number, number];
export type LookId = "morning" | "night" | "ink" | "harbour";

export interface Look {
  id: LookId;
  name: string;
  /** One line on what the look is for. */
  blurb: string;
  /** Basemap recolour (applyLookToMap), by role. */
  map: {
    land: string; water: string; park: string; road: string; roadCasing: string;
    building: string; boundary: string; ink: string; halo: string;
    parkOpacity: number; buildingOpacity: number;
    /**
     * Residential blocks, piers and airport areas (Positron paints them a light grey that
     * suits a light map). Left alone when absent, so Morning stays exactly as it was.
     */
    landuse?: string;
  };
  /** CSS custom properties for the panels (components/ui.ts reads them through var()). */
  ui: Record<string, string>;
  /** Arrow colours for the six shelter bands, most sheltered first (cyclist/windCategory WIND_BANDS). */
  bands: RGB[];
  roadBand: RGBA;
  roadCasing: RGBA;
  buildingFill: RGBA;
  buildingMaterial: { ambient: number; diffuse: number; shininess: number; specularColor: RGB };
  bikeLane: RGBA;
  bikeLaneOnRoad: RGBA;
}

// The panel variables every look sets. Morning's values are also the fallbacks in ui.ts.
const MORNING_UI: Record<string, string> = {
  "--c-text": "#16202b",
  "--c-dim": "#586573",
  "--c-faint": "#929cab",
  "--c-line": "rgba(20,32,43,0.10)",
  "--c-hairline": "rgba(20,32,43,0.06)",
  "--c-accent": "#2f6af0",
  "--c-accent-ink": "#1c4fd0",
  "--c-accent-wash": "rgba(47,106,240,0.10)",
  "--c-accent-line": "rgba(47,106,240,0.42)",
  "--c-good": "#2e7488",
  "--c-warn": "#cf871d",
  "--c-bad": "#b0522e",
  "--c-chip": "rgba(20,32,43,0.045)",
  "--c-panel": "rgba(255,255,255,0.72)",
  "--c-panel-border": "rgba(255,255,255,0.66)",
  "--c-panel-blur": "blur(20px) saturate(1.7)",
  "--c-shadow-card": "0 1px 2px rgba(20,32,43,0.06), 0 10px 30px rgba(20,32,43,0.13)",
  "--c-shadow-pop": "0 2px 8px rgba(20,32,43,0.10), 0 22px 52px rgba(20,32,43,0.20)",
  "--c-surface": "#ffffff",
  "--c-credit": "rgba(247,242,233,0.82)",
  "--c-night-tint": "rgba(40,52,86,0.13)",
  "--c-dial-face": "rgba(28,39,51,0.04)",
  "--c-dial-ring": "rgba(28,39,51,0.22)",
  "--c-dial-tail": "rgba(28,39,51,0.4)",
  "--c-swatch-ring": "rgba(28,39,51,0.12)",
};

export const LOOKS: Record<LookId, Look> = {
  // Today's look: warm linen land, harbour teal water, frosted white panels, violet-blue arrows.
  morning: {
    id: "morning",
    name: "Morning",
    blurb: "Today's look. Warm linen map, frosted panels, violet-blue arrows.",
    map: {
      land: "#f2ede2", water: "#9ed3d8", park: "#c6dca8", road: "#ffffff", roadCasing: "#e8dfcc",
      building: "#ebe4d4", boundary: "#d8ccb6", ink: "#3d4856", halo: "#f7f2e9",
      parkOpacity: 0.85, buildingOpacity: 0.65,
    },
    ui: MORNING_UI,
    bands: [[130, 142, 202], [106, 118, 185], [83, 94, 168], [62, 70, 150], [43, 45, 133], [27, 15, 115]],
    roadBand: [255, 255, 255, 240],
    roadCasing: [222, 214, 199, 255],
    buildingFill: [235, 228, 212, 244],
    buildingMaterial: { ambient: 0.72, diffuse: 0.55, shininess: 8, specularColor: [60, 58, 52] },
    bikeLane: [38, 140, 92, 210],
    bikeLaneOnRoad: [38, 140, 92, 130],
  },

  // Dark map for evening rides. Sheltered streets stay a dim blue; exposed ones glow
  // lamplight amber, so the windiest streets are the brightest thing on screen.
  night: {
    id: "night",
    name: "Night",
    blurb: "Dark harbour map for evening rides. The windiest streets glow amber.",
    map: {
      land: "#12171e", water: "#0d2a33", park: "#14261c", road: "#2b333d", roadCasing: "#1b2129",
      building: "#1d242d", boundary: "#34404c", ink: "#a9b4c1", halo: "#0d1116",
      parkOpacity: 0.9, buildingOpacity: 0.85, landuse: "#181e26",
    },
    ui: {
      ...MORNING_UI,
      "--c-text": "#e9eef4",
      "--c-dim": "#aeb8c5",
      "--c-faint": "#808b99",
      "--c-line": "rgba(255,255,255,0.13)",
      "--c-hairline": "rgba(255,255,255,0.07)",
      "--c-accent": "#4f7ef0",
      "--c-accent-ink": "#a6bfff",
      "--c-accent-wash": "rgba(91,140,255,0.16)",
      "--c-accent-line": "rgba(124,160,255,0.55)",
      "--c-good": "#6cc3d3",
      "--c-warn": "#e8b04f",
      "--c-bad": "#ee8d68",
      "--c-chip": "rgba(255,255,255,0.07)",
      "--c-panel": "rgba(16,21,28,0.78)",
      "--c-panel-border": "rgba(255,255,255,0.09)",
      "--c-panel-blur": "blur(20px) saturate(1.3)",
      "--c-shadow-card": "0 1px 2px rgba(0,0,0,0.35), 0 10px 30px rgba(0,0,0,0.45)",
      "--c-shadow-pop": "0 2px 8px rgba(0,0,0,0.4), 0 22px 52px rgba(0,0,0,0.55)",
      "--c-surface": "#151b23",
      "--c-credit": "rgba(16,21,28,0.8)",
      "--c-night-tint": "rgba(150,170,230,0.14)",
      "--c-dial-face": "rgba(255,255,255,0.05)",
      "--c-dial-ring": "rgba(255,255,255,0.28)",
      "--c-dial-tail": "rgba(255,255,255,0.5)",
      "--c-swatch-ring": "rgba(255,255,255,0.2)",
    },
    bands: ramp(6, [0.5, 0.06, 255], [0.93, 0.13, 85]),
    roadBand: [37, 45, 56, 235],
    roadCasing: [25, 31, 39, 255],
    buildingFill: [50, 59, 72, 238],
    buildingMaterial: { ambient: 0.55, diffuse: 0.6, shininess: 16, specularColor: [40, 48, 60] },
    bikeLane: [72, 200, 146, 200],
    bikeLaneOnRoad: [72, 200, 146, 120],
  },

  // Danish editorial: paper map, graphite streets, flat panels with hairlines, no blur.
  // Arrows are ink greys; the strongly channelled streets alone are flag red.
  ink: {
    id: "ink",
    name: "Ink",
    blurb: "Paper and ink, flat panels. Only the strongly channelled streets are red.",
    map: {
      land: "#f6f5f1", water: "#d6dfe4", park: "#e3e8da", road: "#ffffff", roadCasing: "#d5d1c9",
      building: "#e8e6e0", boundary: "#c8c2b6", ink: "#2a2a2a", halo: "#f6f5f1",
      parkOpacity: 0.9, buildingOpacity: 0.7, landuse: "#eeede8",
    },
    ui: {
      ...MORNING_UI,
      "--c-text": "#111111",
      "--c-dim": "#4d4d4d",
      "--c-faint": "#808080",
      "--c-line": "rgba(0,0,0,0.14)",
      "--c-hairline": "rgba(0,0,0,0.07)",
      "--c-accent": "#c8102e",
      "--c-accent-ink": "#a00d25",
      "--c-accent-wash": "rgba(200,16,46,0.07)",
      "--c-accent-line": "rgba(200,16,46,0.45)",
      "--c-chip": "rgba(0,0,0,0.04)",
      "--c-panel": "rgba(255,255,255,0.97)",
      "--c-panel-border": "rgba(0,0,0,0.13)",
      "--c-panel-blur": "none",
      "--c-shadow-card": "0 1px 0 rgba(0,0,0,0.05)",
      "--c-shadow-pop": "0 6px 22px rgba(0,0,0,0.13)",
      "--c-surface": "#ffffff",
      "--c-credit": "rgba(246,245,241,0.92)",
      "--c-night-tint": "rgba(0,0,0,0.07)",
      "--c-dial-face": "rgba(0,0,0,0.03)",
      "--c-dial-ring": "rgba(0,0,0,0.3)",
      "--c-dial-tail": "rgba(0,0,0,0.45)",
      "--c-swatch-ring": "rgba(0,0,0,0.15)",
    },
    bands: [...ramp(5, [0.76, 0, 0], [0.24, 0, 0]), oklchToRgb(0.55, 0.2, 25)],
    roadBand: [255, 255, 255, 245],
    roadCasing: [212, 208, 200, 255],
    buildingFill: [233, 231, 225, 242],
    buildingMaterial: { ambient: 0.8, diffuse: 0.45, shininess: 4, specularColor: [40, 40, 40] },
    bikeLane: [70, 118, 98, 190],
    bikeLaneOnRoad: [70, 118, 98, 120],
  },

  // Nyhavn colour: sand land, sea-green water, warm panels with a harbour-orange accent.
  // The arrows diverge around "Open", the street-level reference: sheltered streets in
  // calm-water teal, channelled ones in brick red, open ones a quiet sand grey. Both ends
  // stand out, so a rider sees the calm streets and the nasty ones at a glance.
  harbour: {
    id: "harbour",
    name: "Harbour",
    blurb: "Nyhavn colours. Calm streets teal, exposed streets brick red.",
    map: {
      land: "#f3ede3", water: "#78c1c4", park: "#b9d69b", road: "#fffaf1", roadCasing: "#e9d8bd",
      building: "#f0e1cb", boundary: "#d8c4a3", ink: "#383845", halo: "#fbf6ec",
      parkOpacity: 0.85, buildingOpacity: 0.65, landuse: "#eee5d6",
    },
    ui: {
      ...MORNING_UI,
      "--c-text": "#1d2230",
      "--c-dim": "#565b6a",
      "--c-faint": "#8e93a0",
      "--c-accent": "#d9531f",
      "--c-accent-ink": "#ad3f14",
      "--c-accent-wash": "rgba(224,89,42,0.10)",
      "--c-accent-line": "rgba(224,89,42,0.42)",
      "--c-panel": "rgba(255,251,244,0.82)",
      "--c-panel-border": "rgba(255,255,255,0.7)",
      "--c-panel-blur": "blur(18px) saturate(1.6)",
      "--c-surface": "#fffaf3",
      "--c-credit": "rgba(251,246,236,0.86)",
    },
    bands: [
      oklchToRgb(0.5, 0.09, 200), oklchToRgb(0.6, 0.075, 200), oklchToRgb(0.7, 0.05, 195),
      oklchToRgb(0.76, 0.015, 80), oklchToRgb(0.62, 0.13, 45), oklchToRgb(0.5, 0.17, 30),
    ],
    roadBand: [255, 252, 245, 240],
    roadCasing: [233, 216, 189, 255],
    buildingFill: [240, 225, 203, 242],
    buildingMaterial: { ambient: 0.72, diffuse: 0.55, shininess: 8, specularColor: [64, 56, 46] },
    bikeLane: [46, 140, 96, 205],
    bikeLaneOnRoad: [46, 140, 96, 125],
  },
};

export const LOOK_IDS = Object.keys(LOOKS) as LookId[];

/** The look named in the URL hash (`#look=night`), else Morning. */
export function lookFromHash(hash: string): Look {
  const id = new URLSearchParams(hash.replace(/^#/, "")).get("look");
  return id && id in LOOKS ? LOOKS[id as LookId] : LOOKS.morning;
}

/** Set the panel variables on the page. */
export function applyLookToDocument(look: Look, root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(look.ui)) root.style.setProperty(k, v);
  root.dataset.look = look.id;
}

/**
 * Recolour the basemap into a look. OpenMapTiles styles use well-named layers (water,
 * park, landcover_wood, building, boundary_*, highway_*, *_casing), so layers are
 * classified by id and type and repainted role by role: robust to the exact layer set,
 * and far less code than authoring a style.json per look.
 */
export function applyLookToMap(map: maplibregl.Map, look: Look): void {
  const m = look.map;
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    const id = l.id.toLowerCase();
    const set = (prop: string, val: unknown) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.setPaintProperty(l.id, prop as any, val as any);
      } catch { /* layer lacks prop */ }
    };
    try {
      if (l.type === "background") { set("background-color", m.land); continue; }
      if (id.includes("water") && !id.includes("name") && !id.includes("label")) {
        set("fill-color", m.water); set("line-color", m.water); continue;
      }
      if (/(park|wood|grass|green|forest|landcover|pitch|cemetery|scrub|garden)/.test(id) && l.type === "fill") {
        set("fill-color", m.park); set("fill-opacity", m.parkOpacity); continue;
      }
      if (id.includes("building") && l.type === "fill") {
        set("fill-color", m.building); set("fill-opacity", m.buildingOpacity); continue;
      }
      if (id.includes("boundary") && l.type === "line") { set("line-color", m.boundary); continue; }
      if (m.landuse && /(landuse|aeroway|pier)/.test(id) && l.type === "fill") { set("fill-color", m.landuse); continue; }
      if (m.landuse && id.includes("aeroway") && l.type === "line") { set("line-color", m.road); continue; }
      if (/(road|street|bridge|tunnel|transit|rail|highway|path)/.test(id) && l.type === "line") {
        set("line-color", id.includes("casing") || id.includes("outline") ? m.roadCasing : m.road);
        continue;
      }
      if (l.type === "symbol") {
        set("text-color", m.ink);
        set("text-halo-color", m.halo);
        set("text-halo-width", 1.3);
      }
    } catch { /* skip any uncooperative layer */ }
  }
}
