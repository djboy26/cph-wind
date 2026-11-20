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

function Legend({ isMobile, ambientSpeedMs }: { isMobile: boolean; ambientSpeedMs: number }) {
  const [open, setOpen] = useState(!isMobile);

  if (!open) {
    return (
      <button
        className="lift"
        onClick={() => setOpen(true)}
        style={{ ...pill, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}
      >
        <span style={{ display: "flex", gap: 2 }}>
          {WIND_BANDS.map((b) => (
            <span key={b.key} style={{ width: 7, height: 13, borderRadius: 2, background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})` }} />
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
        {WIND_BANDS.map((b) => (
          <div key={b.key} role="listitem" title={b.blurb} aria-label={`${b.label}, ${rangeLabel(b.minRatio, b.maxRatio)} of today's wind: ${b.blurb}`} style={{ display: "contents" }}>
            <span
              style={{
                width: 13, height: 13, borderRadius: 4,
                background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`,
                boxShadow: "0 0 0 1px rgba(28,39,51,0.12)",
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
