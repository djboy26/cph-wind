// src/components/Attribution.tsx
// Map credits, always on screen. OpenStreetMap's ODbL attribution guidelines and the
// basemap provider's terms ask for the credit on the map itself; the About dialog keeps
// the full list. Update the basemap credit when the basemap changes (Protomaps, sprint 2).
import type { CSSProperties } from "react";
import { COLORS, FONT } from "./ui";

const link: CSSProperties = { color: "inherit", textDecoration: "none" };

export default function Attribution({ style, short = false }: { style?: CSSProperties; short?: boolean }) {
  return (
    <div
      role="contentinfo"
      aria-label="Map data credits"
      style={{
        fontFamily: FONT,
        fontSize: 11,
        lineHeight: "16px",
        color: COLORS.dim,
        background: "rgba(247,242,233,0.82)",
        padding: "0 6px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        pointerEvents: "auto",
        ...style,
      }}
    >
      © <a style={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      {short ? "" : " contributors"} · © <a style={link} href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>
    </div>
  );
}
