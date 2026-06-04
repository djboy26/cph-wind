// src/components/RoutePanel.tsx
// Route-planning controls + the list of compared A→B options with their wind data.
// Presentational: all state lives in App.

import { RANK_CRITERIA, type RouteOption, type RankCriterion } from "../routing/windRoute";

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
  bestId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  criterion: RankCriterion;
  onCriterion: (c: RankCriterion) => void;
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
  onUseGps, onReset, options, bestId, selectedId, onSelect, criterion, onCriterion, isMobile,
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

  const criterionLabel = RANK_CRITERIA.find((c) => c.key === criterion)?.label ?? "";
  const status =
    !start ? "Click the map to set your start (or use GPS)." :
    !end ? "Now click your destination." :
    building ? "Preparing road network…" :
    options.length === 0 ? "No route found between those points." :
    windSimilar ? `${options.length} routes — wind is similar on all (★ = ${criterionLabel}).` :
    `${options.length} routes ranked by ${criterionLabel} (★ = best).`;

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

      {options.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Rank by
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {RANK_CRITERIA.map((c) => (
              <button
                key={c.key}
                title={c.hint}
                onClick={() => onCriterion(c.key)}
                style={{
                  ...BTN,
                  padding: "4px 9px",
                  fontSize: 12,
                  border: c.key === criterion ? "1.5px solid #1e78f0" : "1px solid #ccc",
                  background: c.key === criterion ? "#eaf2ff" : "white",
                  fontWeight: c.key === criterion ? 600 : 400,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
                  {o.id === bestId ? "★ " : ""}Route {i + 1}
                  {o.id === bestId && <span style={{ color: "#1a7f37", marginLeft: 6, fontSize: 11 }}>{criterionLabel}</span>}
                  {o.id === shortestId && o.id !== bestId && <span style={{ color: "#666", marginLeft: 6, fontSize: 11 }}>Shortest</span>}
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
