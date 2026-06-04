// src/components/Legend.tsx
// Collapsible cyclist wind-strength legend.

import { useState } from "react";
import { WIND_BANDS } from "../cyclist/windCategory";
import { glass, pill, COLORS } from "./ui";

function rangeLabel(minMs: number, maxMs: number): string {
  return maxMs === Infinity ? `${minMs}+` : `${minMs}–${maxMs}`;
}

export default function Legend({ isMobile }: { isMobile: boolean }) {
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
    <div className="ui-up" style={{ ...glass, padding: "11px 15px", minWidth: 232 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <span style={{ fontSize: 10.5, color: COLORS.faint, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 }}>
          Wind on street (m/s)
        </span>
        <button
          onClick={() => setOpen(false)}
          aria-label="Collapse legend"
          style={{ border: "none", background: "transparent", color: COLORS.dim, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: 0 }}
        >–</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {WIND_BANDS.map((b) => (
          <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{
                width: 13, height: 13, borderRadius: 4, flex: "0 0 auto",
                background: `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`,
                boxShadow: "0 0 0 1px rgba(28,39,51,0.12)",
              }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 600, width: 74, color: COLORS.text }}>{b.label}</span>
            <span style={{ fontSize: 11, color: COLORS.dim, width: 36, textAlign: "right" }}>{rangeLabel(b.minMs, b.maxMs)}</span>
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
