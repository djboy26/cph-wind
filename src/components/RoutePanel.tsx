// src/components/RoutePanel.tsx
// Route-planning controls + the list of compared A→B options with their wind data.
// Presentational: all state lives in App.

import { RANK_CRITERIA, type RouteOption, type RankCriterion } from "../routing/windRoute";
import { glass, pill, pillActive, COLORS, NUM, label } from "./ui";
import { Icon } from "./Icon";

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
// "Wind suffered": the headwind the rider actually faces given their travel
// direction (+ headwind = suffering, − = tailwind helping).
function windSuffered(avgHeadwindMs: number) {
  if (avgHeadwindMs > 0.3) return { text: `${avgHeadwindMs.toFixed(1)} m/s headwind`, color: COLORS.bad };
  if (avgHeadwindMs < -0.3) return { text: `${(-avgHeadwindMs).toFixed(1)} m/s tailwind`, color: COLORS.good };
  return { text: "crosswind", color: COLORS.dim };
}

export default function RoutePanel({
  active, onToggle, start, end, building, gpsLoading, gpsError,
  onUseGps, onReset, options, bestId, selectedId, onSelect, criterion, onCriterion, isMobile,
}: Props) {
  if (!active) {
    return (
      <button
        onClick={onToggle}
        className="lift"
        style={{ ...glass, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", fontWeight: 600, fontSize: 14, color: COLORS.text, cursor: "pointer" }}
      >
        <Icon name="route" size={17} color={COLORS.accent} />
        Plan a route
      </button>
    );
  }

  const shortestId = options.reduce<string | null>(
    (best, o) => (best == null || o.metrics.distanceM < options.find((x) => x.id === best)!.metrics.distanceM ? o.id : best),
    null,
  );

  // Routes between fixed points can't escape the net wind — flag when they're close.
  const exposures = options.map((o) => o.metrics.headwindExposure);
  const windSimilar = options.length > 1 && Math.max(...exposures) - Math.min(...exposures) < 0.06;

  const criterionLabel = RANK_CRITERIA.find((c) => c.key === criterion)?.label ?? "";
  const status =
    !start ? "Click the map to set your start (or use GPS)." :
    !end ? "Now click your destination." :
    building ? "Finding the best routes…" :
    options.length === 0 ? "No route found between those points." :
    windSimilar ? `${options.length} routes — wind is similar on all (★ = ${criterionLabel}).` :
    `${options.length} routes ranked by ${criterionLabel} (★ = best).`;

  return (
    <div style={{ ...glass, padding: "13px 15px", width: isMobile ? "auto" : 304, maxHeight: isMobile ? "46vh" : "72vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: -0.2 }}>Plan a route</span>
        <button
          onClick={onToggle}
          aria-label="Close"
          style={{ ...pill, display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, borderRadius: "50%" }}
        >
          <Icon name="close" size={15} color={COLORS.dim} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button
          onClick={onUseGps}
          disabled={gpsLoading}
          style={{ ...pill, flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, opacity: gpsLoading ? 0.6 : 1 }}
        >
          <Icon name="target" size={15} color={COLORS.accent} />
          {gpsLoading ? "Locating…" : "My location"}
        </button>
        <button
          onClick={onReset}
          style={{ ...pill, display: "flex", alignItems: "center", gap: 6 }}
        >
          <Icon name="reset" size={14} color={COLORS.dim} />
          Reset
        </button>
      </div>
      {gpsError && <div style={{ fontSize: 11, color: COLORS.bad, marginBottom: 6 }}>{gpsError}</div>}

      {options.length > 0 && (
        <div style={{ marginBottom: 9 }}>
          <div style={{ ...label, marginBottom: 6 }}>Rank by</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {RANK_CRITERIA.map((c) => (
              <button
                key={c.key}
                title={c.hint}
                onClick={() => onCriterion(c.key)}
                style={{ ...(c.key === criterion ? pillActive : pill), padding: "4px 10px", fontSize: 12 }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: COLORS.dim, marginBottom: options.length ? 10 : 0 }}>{status}</div>

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
                border: sel ? "1.5px solid rgba(46,124,246,0.65)" : `1px solid ${COLORS.line}`,
                background: sel ? "rgba(46,124,246,0.10)" : "rgba(28,39,51,0.03)",
                borderRadius: 12,
                padding: "9px 11px",
                cursor: "pointer",
                fontFamily: "inherit",
                color: COLORS.text,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {o.id === bestId ? "★ " : ""}Route {i + 1}
                  {o.id === bestId && <span style={{ color: COLORS.good, marginLeft: 6, fontSize: 11 }}>{criterionLabel}</span>}
                  {o.id === shortestId && o.id !== bestId && <span style={{ color: COLORS.faint, marginLeft: 6, fontSize: 11 }}>Shortest</span>}
                </span>
                <span style={{ fontSize: 10.5, color: COLORS.faint, ...NUM }}>{fmtKm(o.metrics.distanceM)}</span>
              </div>
              {/* Three criteria: time · wind suffered · % into wind */}
              <div style={{ fontSize: 11, color: COLORS.dim, marginTop: 5, display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, ...NUM }}>
                <span><span style={{ color: COLORS.faint }}>time </span>{fmtMin(o.metrics.timeS)}</span>
                <span><span style={{ color: COLORS.faint }}>wind </span><span style={{ color: wind.color, fontWeight: 600 }}>{wind.text}</span></span>
                <span><span style={{ color: COLORS.faint }}>into wind </span>{Math.round(o.metrics.headwindExposure * 100)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
