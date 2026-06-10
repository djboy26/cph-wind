// src/components/TopBar.tsx
// Floating header: live regional wind + the primary "Plan route" action.
// "Plan route" is a filled accent button (the one obvious call-to-action); on
// mobile the live-wind block doubles as the brand so the CTA has room to be labelled.

import type { Wind } from "../math";
import { feelsLikeC } from "../cyclist/feelsLike";
import { glass, pill, COLORS, NUM, FONT } from "./ui";
import { Icon } from "./Icon";

interface Props {
  wind: Wind | null;
  /** Air temperature for the active hour, °C. */
  tempC?: number;
  timestamp?: string;
  loading: boolean;
  routingActive: boolean;
  onPlanRoute: () => void;
  onAbout: () => void;
  isMobile: boolean;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
const compassPoint = (deg: number) => POINTS[Math.round(deg / 22.5) % 16];

function WindDial({ deg, size = 30 }: { deg: number; size?: number }) {
  const c = size / 2;
  const r = size / 2 - 2;
  return (
    <svg width={size} height={size} aria-hidden style={{ flex: "0 0 auto" }}>
      <circle cx={c} cy={c} r={r} fill="rgba(28,39,51,0.04)" stroke="rgba(28,39,51,0.22)" strokeWidth={1} />
      <g transform={`rotate(${deg} ${c} ${c})`}>
        <polygon points={`${c},${c - r + 2} ${c - 3.2},${c + 2} ${c + 3.2},${c + 2}`} fill="#e0533d" />
        <polygon points={`${c},${c + r - 2} ${c - 3.2},${c - 2} ${c + 3.2},${c - 2}`} fill="rgba(28,39,51,0.4)" />
      </g>
    </svg>
  );
}

export default function TopBar({ wind, tempC, timestamp, loading, routingActive, onPlanRoute, onAbout, isMobile }: Props) {
  const deg = wind?.directionDeg ?? 0;
  const timestampLabel = timestamp
    ? new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null;
  // "Feels like" — wind chill on a cold, breezy day. Only worth showing when it
  // diverges from the air temperature by a degree or more.
  const feels = tempC != null && wind ? feelsLikeC(tempC, wind.speedMs) : null;
  const showFeels = tempC != null && feels != null && Math.abs(tempC - feels) >= 1;

  // Live wind: identity on desktop (sits beside the brand), and the brand itself on mobile.
  const windBlock = (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <span className="live-dot" />
      <WindDial deg={deg} size={isMobile ? 26 : 30} />
      <div style={{ lineHeight: 1.2, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, letterSpacing: -0.3, color: COLORS.text, ...NUM, minWidth: 0 }}>
          {loading || !wind ? "—" : wind.speedMs.toFixed(1)}
          <span style={{ fontSize: 10.5, color: COLORS.dim, marginLeft: 3, fontWeight: 500 }}>m/s</span>
        </div>
        <div style={{ fontSize: 10.5, color: COLORS.faint, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 4 }}>
          <span>{wind ? `from ${compassPoint(deg)}` : "loading"}</span>
          {timestampLabel && <span>· {timestampLabel}</span>}
        </div>
      </div>
      {tempC != null && (
        <div
          style={{
            paddingLeft: 9,
            marginLeft: 2,
            borderLeft: `1px solid ${COLORS.line}`,
            lineHeight: 1.2,
            ...NUM,
          }}
        >
          <div style={{ fontSize: isMobile ? 14 : 15.5, fontWeight: 700, color: COLORS.text }}>{Math.round(tempC)}°</div>
          {showFeels && (
            <div style={{ fontSize: 10.5, color: COLORS.faint }}>feels {Math.round(feels!)}°</div>
          )}
        </div>
      )}
    </div>
  );

  const brand = (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <WindDial deg={deg} size={32} />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, letterSpacing: -0.3, color: COLORS.text }}>Copenhagen Wind</div>
        <div style={{ fontSize: 10.5, color: COLORS.faint, letterSpacing: 0.3 }}>live cycling wind map</div>
      </div>
    </div>
  );

  return (
    <header
      className="ui-down"
      style={{
        ...glass,
        position: "absolute",
        top: isMobile ? "calc(env(safe-area-inset-top) + 8px)" : 14,
        left: isMobile ? "calc(env(safe-area-inset-left) + 8px)" : 14,
        right: isMobile ? "calc(env(safe-area-inset-right) + 8px)" : 14,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: isMobile ? "8px 10px" : "9px 14px",
        borderRadius: 16,
      }}
    >
      {isMobile ? windBlock : brand}

      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        {!isMobile && windBlock}

        {/* Primary call-to-action: filled accent so a new user can't miss where to start. */}
        <button
          className="lift"
          onClick={onPlanRoute}
          aria-label={routingActive ? "Close route planner" : "Plan a route"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            whiteSpace: "nowrap",
            cursor: "pointer",
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: isMobile ? 13 : 13.5,
            padding: isMobile ? "9px 14px" : "9px 18px",
            borderRadius: 999,
            border: routingActive ? `1px solid ${COLORS.accentLine}` : "1px solid transparent",
            background: routingActive ? COLORS.accentWash : COLORS.accent,
            color: routingActive ? COLORS.accentInk : "#fff",
            boxShadow: routingActive ? "none" : "0 3px 12px rgba(47,106,240,0.34)",
          }}
        >
          <Icon name="route" size={16} color={routingActive ? COLORS.accentInk : "#fff"} />
          {routingActive ? "Close" : "Plan route"}
        </button>

        <button
          className="lift"
          onClick={onAbout}
          aria-label="About"
          style={{ ...pill, display: "flex", alignItems: "center", justifyContent: "center", width: isMobile ? 38 : 36, height: isMobile ? 38 : 36, padding: 0, borderRadius: "50%" }}
        >
          <Icon name="info" size={17} color={COLORS.dim} />
        </button>
      </div>
    </header>
  );
}
