// src/components/Legend.tsx
// Cyclist wind-strength category legend for the per-street visualization.

import { WIND_BANDS } from "../cyclist/windCategory";

function rangeLabel(minMs: number, maxMs: number): string {
  if (maxMs === Infinity) return `${minMs}+`;
  return `${minMs}–${maxMs}`;
}

export default function Legend() {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.95)",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        padding: "10px 14px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#222",
        minWidth: 220,
      }}
    >
      <div style={{ fontSize: 11, color: "#444", marginBottom: 8, fontWeight: 600 }}>
        Wind on street — cyclist scale (m/s)
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {WIND_BANDS.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`,
                flex: "0 0 auto",
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 600, width: 72 }}>{b.label}</span>
            <span style={{ fontSize: 11, color: "#666", width: 36, textAlign: "right" }}>
              {rangeLabel(b.minMs, b.maxMs)}
            </span>
            <span style={{ fontSize: 10, color: "#999" }}>{b.blurb}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginTop: 8, lineHeight: 1.3 }}>
        Color = wind strength along the street. Click a street for headwind / tailwind impact.
      </div>
    </div>
  );
}
