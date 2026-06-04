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
function windDeltaLabel(deltaS: number) {
  const m = Math.abs(deltaS) / 60;
  if (m < 0.5) return { text: "wind neutral", color: "#666" };
  return deltaS < 0
    ? { text: `saves ${m.toFixed(0)}–${Math.ceil(m)} min`, color: "#1a7f37" }
    : { text: `costs ${m.toFixed(0)}–${Math.ceil(m)} min`, color: "#b5480f" };
}
function headLabel(avgHeadwindMs: number) {
  if (avgHeadwindMs > 0.3) return `${avgHeadwindMs.toFixed(1)} m/s headwind`;
  if (avgHeadwindMs < -0.3) return `${(-avgHeadwindMs).toFixed(1)} m/s tailwind`;
  return "crosswind";
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

  const status =
    !start ? "Click the map to set your start (or use GPS)." :
    !end ? "Now click your destination." :
    building ? "Preparing road network…" :
    options.length === 0 ? "No route found between those points." :
    `${options.length} route${options.length > 1 ? "s" : ""} — best for wind is starred.`;

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
          const delta = windDeltaLabel(o.metrics.windDeltaS);
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
                <span style={{ fontSize: 13, color: "#444" }}>{fmtKm(o.metrics.distanceM)} · {fmtMin(o.metrics.timeS)}</span>
              </div>
              <div style={{ fontSize: 11, color: "#555", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span style={{ color: delta.color, fontWeight: 600 }}>{delta.text}</span>
                <span>{headLabel(o.metrics.avgHeadwindMs)}</span>
                <span>{Math.round(o.metrics.headwindExposure * 100)}% into wind</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
