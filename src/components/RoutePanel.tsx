// src/components/RoutePanel.tsx
// Route-planning controls + the list of compared A→B options with their wind data.
// Presentational: all state lives in App.

import { RANK_CRITERIA, type RouteOption, type RankCriterion } from "../routing/windRoute";
import { glass, pill, pillActive, COLORS, NUM, label } from "./ui";
import { Icon } from "./Icon";
import LocationSearch from "./LocationSearch";

interface Waypoint { lat: number; lon: number; label: string; }

interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  active: boolean;
  onToggle: () => void;
  start: LatLon | null;
  end: LatLon | null;
  startLabel: string | null;
  endLabel: string | null;
  onPickStart: (wp: Waypoint) => void;
  onPickEnd: (wp: Waypoint) => void;
  onClearStart: () => void;
  onClearEnd: () => void;
  onSwap: () => void;
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
  active, onToggle, start, end, startLabel, endLabel,
  onPickStart, onPickEnd, onClearStart, onClearEnd, onSwap,
  building, gpsLoading, gpsError,
  onUseGps, onReset, options, bestId, selectedId, onSelect, criterion, onCriterion, isMobile,
}: Props) {
  if (!active) {
    return (
      <button
        onClick={onToggle}
        className="lift"
        style={{ ...glass, display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", fontWeight: 600, fontSize: 14, color: COLORS.text, cursor: "pointer" }}
      >
        <Icon name="route" size={17} color={COLORS.accent} />
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 0 }}>
          <span>Plan a route</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: COLORS.dim }}>Search, tap the map, or use GPS</span>
        </span>
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

  // Commute view: the wind you get going out reverses on the way back, so a tailwind
  // now becomes a headwind later. Show both for the highlighted route.
  const selected = options.find((o) => o.id === selectedId) ?? options.find((o) => o.id === bestId) ?? options[0];
  const roundTrip = selected
    ? { out: windSuffered(selected.metrics.avgHeadwindMs), back: windSuffered(-selected.metrics.avgHeadwindMs) }
    : null;

  const criterionLabel = RANK_CRITERIA.find((c) => c.key === criterion)?.label ?? "";
  const status =
    !start ? "Search, tap the map, or use GPS for your start." :
    !end ? "Now choose your destination." :
    building ? "Finding routes…" :
    options.length === 0 ? "No route found between those points." :
    windSimilar ? `${options.length} routes · wind similar on all` :
    `${options.length} routes · ★ best for ${criterionLabel.toLowerCase()}`;

  // Desktop: cap height so the panel (anchored at top:78) never reaches the
  // forecast strip docked bottom-left; it scrolls internally instead.
  return (
    <div style={{ ...glass, padding: "13px 15px", width: isMobile ? "auto" : 304, maxHeight: isMobile ? "46vh" : "calc(100vh - 210px)", overflowY: "auto" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <LocationSearch
            kind="start"
            placeholder="Choose start"
            value={startLabel}
            onPick={onPickStart}
            onClear={onClearStart}
            onGps={onUseGps}
            gpsLoading={gpsLoading}
          />
          <LocationSearch
            kind="end"
            placeholder="Choose destination"
            value={endLabel}
            onPick={onPickEnd}
            onClear={onClearEnd}
            autoFocus={!!start && !end}
          />
        </div>
        <button
          onClick={onSwap}
          disabled={!start && !end}
          className="lift"
          aria-label="Swap start and destination"
          title="Swap"
          style={{ ...pill, width: 34, height: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: start || end ? 1 : 0.4 }}
        >
          <Icon name="swap" size={16} color={COLORS.dim} />
        </button>
      </div>
      {gpsError && <div style={{ fontSize: 11, color: COLORS.bad, marginBottom: 8 }}>{gpsError}</div>}
      {(start || end) && (
        <button
          onClick={onReset}
          style={{ border: "none", background: "transparent", color: COLORS.dim, fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 10, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}
        >
          <Icon name="reset" size={13} color={COLORS.faint} />
          Clear all
        </button>
      )}

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
              {/* time · wind suffered · % into wind — one concise line */}
              <div style={{ fontSize: 11.5, color: COLORS.dim, marginTop: 4, ...NUM }}>
                {fmtMin(o.metrics.timeS)} · <span style={{ color: wind.color, fontWeight: 600 }}>{wind.text}</span> · {Math.round(o.metrics.headwindExposure * 100)}% into wind
              </div>
            </button>
          );
        })}
      </div>

      {roundTrip && (
        <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${COLORS.hairline}` }}>
          <div style={{ ...label, marginBottom: 5 }}>Round trip</div>
          <div style={{ display: "flex", gap: 16, fontSize: 11.5, color: COLORS.dim, ...NUM }}>
            <span><span style={{ color: COLORS.faint }}>out </span><span style={{ color: roundTrip.out.color, fontWeight: 600 }}>{roundTrip.out.text}</span></span>
            <span><span style={{ color: COLORS.faint }}>back </span><span style={{ color: roundTrip.back.color, fontWeight: 600 }}>{roundTrip.back.text}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}
