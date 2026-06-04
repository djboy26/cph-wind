// src/components/RoutePanel.tsx
// Route-planning controls + the list of compared A→B options with their wind data.
// Presentational: all state lives in App.

import type { RouteOption } from "../routing/windRoute";

interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  active: boolean;
  onToggle: () => void;
  start: LatLon | null;
  end: LatLon | null;
  building: boolean;
  gpsLoading: boolean;
  gpsError: string | null;
  onUseGps: () => void;
  onReset: () => void;
  options: RouteOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isMobile: boolean;
}

function fmtKm(m: number) {
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
function fmtMin(s: number) {
  return `${Math.round(s / 60)} min`;
}
// "Wind suffered": the headwind the rider actually faces given their direction of
// travel (+ headwind = suffering, − = tailwind helping).
function windSuffered(avgHeadwindMs: number) {
  if (avgHeadwindMs > 0.3) return { text: `${avgHeadwindMs.toFixed(1)} m/s headwind`, color: "#b5480f" };
  if (avgHeadwindMs < -0.3) return { text: `${(-avgHeadwindMs).toFixed(1)} m/s tailwind`, color: "#1a7f37" };
  return { text: "crosswind", color: "#666" };
}

const BTN: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 7,
  border: "1px solid #ccc",
  background: "white",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "system-ui, sans-serif",
};

export default function RoutePanel({
  active, onToggle, start, end, building, gpsLoading, gpsError,
  onUseGps, onReset, options, selectedId, onSelect, isMobile,
}: Props) {
  if (!active) {
    return (
      <button
        onClick={onToggle}
        style={{ ...BTN, fontWeight: 600, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}
      >
        🧭 Plan a route
      </button>
    );
  }

  const shortestId = options.reduce<string | null>(
    (best, o) => (best == null || o.metrics.distanceM < options.find((x) => x.id === best)!.metrics.distanceM ? o.id : best),
    null,
  );

  // Routes between fixed points can't escape the net wind — flag when they're close.
  const exposures = options.map((o) => o.metrics.headwindExposure);
  const windSimilar =
    options.length > 1 && Math.max(...exposures) - Math.min(...exposures) < 0.06;

  const status =
    !start ? "Click the map to set your start (or use GPS)." :
    !end ? "Now click your destination." :
    building ? "Preparing road network…" :
    options.length === 0 ? "No route found between those points." :
    windSimilar ? `${options.length} routes — wind is similar on all (★ = least into-wind).` :
    `${options.length} routes — ★ is best for wind (least into-wind).`;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.97)",
        borderRadius: 10,
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        padding: "12px 14px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        color: "#222",
        width: isMobile ? "auto" : 300,
        maxHeight: isMobile ? "45vh" : "70vh",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Plan a route</span>
        <button onClick={onToggle} style={{ ...BTN, padding: "3px 8px" }} aria-label="Close">×</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={onUseGps} disabled={gpsLoading} style={{ ...BTN, flex: 1 }}>
          {gpsLoading ? "Locating…" : "📍 Use my location"}
        </button>
        <button onClick={onReset} style={BTN}>Reset</button>
      </div>
      {gpsError && <div style={{ fontSize: 11, color: "#b5480f", marginBottom: 6 }}>{gpsError}</div>}

      <div style={{ fontSize: 12, color: "#555", marginBottom: options.length ? 10 : 0 }}>{status}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((o, i) => {
          const sel = o.id === selectedId;
          const wind = windSuffered(o.metrics.avgHeadwindMs);
          return (
            <button
              key={o.id}
              onClick={() => onSelect(o.id)}
              style={{
                textAlign: "left",
                border: sel ? "2px solid #1e78f0" : "1px solid #ddd",
                background: sel ? "#f0f6ff" : "white",
                borderRadius: 8,
                padding: "8px 10px",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {o.bestWind ? "★ " : ""}Route {i + 1}
                  {o.bestWind && <span style={{ color: "#1a7f37", marginLeft: 6, fontSize: 11 }}>Best for wind</span>}
                  {o.id === shortestId && !o.bestWind && <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>Shortest</span>}
                </span>
              </div>
              {/* Three criteria: time · wind suffered · % into wind */}
              <div style={{ fontSize: 11, color: "#555", marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                <span><span style={{ color: "#999" }}>time </span>{fmtMin(o.metrics.timeS)}</span>
                <span><span style={{ color: "#999" }}>wind </span><span style={{ color: wind.color, fontWeight: 600 }}>{wind.text}</span></span>
                <span><span style={{ color: "#999" }}>into wind </span>{Math.round(o.metrics.headwindExposure * 100)}%</span>
              </div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 2 }}>{fmtKm(o.metrics.distanceM)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
