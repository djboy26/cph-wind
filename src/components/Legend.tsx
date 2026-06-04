// src/components/Legend.tsx
// Cyclist wind-strength category legend for the per-street visualization.

import { WIND_BANDS } from "../cyclist/windCategory";
import { glass, COLORS } from "./ui";

function rangeLabel(minMs: number, maxMs: number): string {
  if (maxMs === Infinity) return `${minMs}+`;
  return `${minMs}–${maxMs}`;
}

export default function Legend() {
  return (
    <div style={{ ...glass, padding: "11px 15px", minWidth: 230 }}>
      <div style={{ fontSize: 10.5, color: COLORS.faint, marginBottom: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
        Wind on street — cyclist scale (m/s)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {WIND_BANDS.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 4,
                background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`,
                flex: "0 0 auto",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
              }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, width: 74, color: COLORS.text }}>{b.label}</span>
            <span style={{ fontSize: 11, color: COLORS.dim, width: 36, textAlign: "right" }}>
              {rangeLabel(b.minMs, b.maxMs)}
            </span>
            <span style={{ fontSize: 10, color: COLORS.faint }}>{b.blurb}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: COLORS.faint, marginTop: 9, lineHeight: 1.35 }}>
        Color = wind strength along the street. Click a street for headwind / tailwind impact.
      </div>
    </div>
  );
}
