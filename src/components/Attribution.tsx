// src/components/Attribution.tsx
// Map credits, always on screen. OpenStreetMap's attribution guidelines and OpenFreeMap's
// terms ask for the credit on the map itself: "© OpenMapTiles" and the OpenStreetMap data
// credit, each linked. The About dialog keeps the full list. Update this when the basemap
// changes (docs/decisions.md D5).
import { memo } from "react";
import type { CSSProperties } from "react";
import { COLORS, FONT } from "./ui";

const link: CSSProperties = { color: "inherit", textDecoration: "none" };

function Attribution({ style, short = false }: { style?: CSSProperties; short?: boolean }) {
  return (
    <div
      role="contentinfo"
      aria-label="Map data credits"
      style={{
        fontFamily: FONT,
        fontSize: 11,
        lineHeight: short ? "14px" : "16px",
        textAlign: "right",
        color: COLORS.dim,
        background: COLORS.credit,
        padding: "0 6px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        pointerEvents: "auto",
        ...style,
      }}
    >
      © <a style={link} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      {short ? "" : " contributors"} · © <a style={link} href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>
      {/* OpenFreeMap's own credit line names it too; on a phone it takes a second line. */}
      {short ? <br /> : " · "}<a style={link} href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a>
    </div>
  );
}

// Memoised: the map re-renders the app on every pan frame; this only re-renders when its props change.
export default memo(Attribution);
