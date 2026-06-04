// src/components/TopBar.tsx
// Floating header: brand identity + live regional wind + primary actions.

import type { Wind } from "../math";
import { glass, pill, pillActive, COLORS } from "./ui";

interface Props {
  wind: Wind | null;
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

function Brand({ deg, compact }: { deg: number; compact: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <WindDial deg={deg} size={compact ? 26 : 32} />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontWeight: 700, fontSize: compact ? 14 : 15.5, letterSpacing: -0.3, color: COLORS.text }}>
          Copenhagen Wind
        </div>
        {!compact && (
          <div style={{ fontSize: 10.5, color: COLORS.faint, letterSpacing: 0.3 }}>live cycling wind map</div>
        )}
      </div>
    </div>
  );
}

export default function TopBar({ wind, timestamp, loading, routingActive, onPlanRoute, onAbout, isMobile }: Props) {
  const deg = wind?.directionDeg ?? 0;

  const liveWind = (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span className="live-dot" />
      <WindDial deg={deg} size={isMobile ? 24 : 30} />
      <div style={{ lineHeight: 1.12 }}>
        <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, letterSpacing: -0.3, color: COLORS.text }}>
          {loading || !wind ? "—" : wind.speedMs.toFixed(1)}
          <span style={{ fontSize: 10.5, color: COLORS.dim, marginLeft: 3, fontWeight: 500 }}>m/s</span>
        </div>
        <div style={{ fontSize: 10.5, color: COLORS.faint }}>
          {wind ? `from ${compassPoint(deg)}` : "loading"}
          {timestamp && !isMobile && ` · ${new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}
        </div>
      </div>
    </div>
  );

  return (
    <header
      className="ui-down"
      style={{
        ...glass,
        position: "absolute",
        top: isMobile ? 8 : 14,
        left: isMobile ? 8 : 14,
        right: isMobile ? 8 : 14,
        zIndex: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: isMobile ? "8px 10px" : "9px 14px",
        borderRadius: 16,
      }}
    >
      <Brand deg={deg} compact={isMobile} />

      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 14 }}>
        {!isMobile && liveWind}
        {isMobile && (
          <span style={{ fontSize: 14, fontWeight: 700, color: COLORS.text, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="live-dot" />
            {loading || !wind ? "—" : `${wind.speedMs.toFixed(1)}`}
            <span style={{ fontSize: 10, color: COLORS.faint, fontWeight: 500 }}>m/s {wind ? compassPoint(deg) : ""}</span>
          </span>
        )}
        <button
          className="lift"
          onClick={onPlanRoute}
          style={{ ...(routingActive ? pillActive : pill), padding: isMobile ? "7px 10px" : "8px 14px", fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {isMobile ? "🧭" : "🧭 Plan route"}
        </button>
        <button
          className="lift"
          onClick={onAbout}
          aria-label="About"
          style={{ ...pill, width: 34, height: 34, padding: 0, borderRadius: "50%", fontFamily: "Georgia, serif", fontStyle: "italic", fontWeight: 700 }}
        >
          i
        </button>
      </div>
    </header>
  );
}
