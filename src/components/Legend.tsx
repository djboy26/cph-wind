// src/components/Legend.tsx
// Collapsible cyclist shelter legend. The arrow colours are a ratio of today's wind,
// so the reference ambient has to be on screen or the scale says nothing.

import { memo, useState } from "react";
import { WIND_BANDS } from "../cyclist/windCategory";
import { glass, pill, COLORS, NUM, label } from "./ui";

// Ratios read better as a percentage of the open-air wind; the heading carries the m/s.
function rangeLabel(minRatio: number, maxRatio: number): string {
  const pct = (r: number) => Math.round(r * 100);
  if (maxRatio === Infinity) return `${pct(minRatio)}%+`;
  return `${pct(minRatio)}–${pct(maxRatio)}%`;
}

function Legend({ isMobile, ambientSpeedMs, colors }: { isMobile: boolean; ambientSpeedMs: number; colors?: readonly [number, number, number][] }) {
  // The look's band colours (src/looks), in WIND_BANDS order; the bands' own without one.
  const rgb = (i: number) => { const c = colors?.[i] ?? WIND_BANDS[i].color; return `rgb(${c[0]},${c[1]},${c[2]})`; };
  const [open, setOpen] = useState(!isMobile);

  if (!open) {
    return (
      <button
        className="lift"
        onClick={() => setOpen(true)}
        style={{ ...pill, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}
      >
        <span style={{ display: "flex", gap: 2 }}>
          {WIND_BANDS.map((b, i) => (
            <span key={b.key} style={{ width: 7, height: 13, borderRadius: 2, background: rgb(i) }} />
          ))}
        </span>
        Wind scale
      </button>
    );
  }

  return (
    <div className="ui-up" style={{ ...glass, padding: "11px 15px", minWidth: 232, maxWidth: 300 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <span style={label}>Shelter · relative to {ambientSpeedMs.toFixed(1)} m/s now</span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse legend"
          style={{ border: "none", background: "transparent", color: COLORS.dim, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
        >–</button>
      </div>
      {/* One grid for all six rows: each column takes the width of its longest entry, so
          no name wraps ("Strongly channelled" did, at a fixed 104 px) and the ranges line
          up. The one-line explanations moved to each row's tooltip: on one line each they
          made the legend 620 px wide, a sixth of a laptop screen. */}
      <div role="list" style={{ display: "grid", gridTemplateColumns: "13px max-content max-content", columnGap: 10, rowGap: 6, alignItems: "center" }}>
        {WIND_BANDS.map((b, i) => (
          <div key={b.key} role="listitem" title={b.blurb} aria-label={`${b.label}, ${rangeLabel(b.minRatio, b.maxRatio)} of today's wind: ${b.blurb}`} style={{ display: "contents" }}>
            <span
              style={{
                width: 13, height: 13, borderRadius: 4,
                background: rgb(i),
                boxShadow: `0 0 0 1px ${COLORS.swatchRing}`,
              }}
            />
            <span title={b.blurb} style={{ fontSize: 11.5, fontWeight: 600, color: COLORS.text, whiteSpace: "nowrap", cursor: "help" }}>{b.label}</span>
            <span style={{ fontSize: 11, color: COLORS.dim, textAlign: "right", whiteSpace: "nowrap", ...NUM }}>{rangeLabel(b.minRatio, b.maxRatio)}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 9, lineHeight: 1.35 }}>
        Color = how much of today's wind reaches the street. Click a street for its speed in
        m/s and headwind / tailwind impact.
      </div>
    </div>
  );
}

// Memoised: the map re-renders the app on every pan frame; this only re-renders when its props change.
export default memo(Legend);
