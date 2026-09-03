// src/components/RoutePanel.tsx
// Route-planning controls + the ranked A→B options.
// Presentational: all state lives in App, and every string or number the panel
// says is decided in cyclist/routeCopy.ts. This file holds markup only.

import type { CSSProperties } from "react";
import type { RouteOption, RankCriterion } from "../routing/windRoute";
import { formatWindDelta, verdictFor, type BestWindow } from "../cyclist/routeCopy";
import { glass, pill, COLORS, NUM } from "./ui";
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
  /** Kept for the caller; the panel shows nothing while routes are being found. */
  building: boolean;
  gpsLoading: boolean;
  gpsError: string | null;
  onUseGps: () => void;
  onReset: () => void;
  options: RouteOption[];
  /** Kept for the caller; rank is carried by row order, so no row is badged. */
  bestId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  criterion: RankCriterion;
  onCriterion: (c: RankCriterion) => void;
  /** True when wind costs every option about the same — drives the verdict. */
  windIsSimilar: boolean;
  /** A better hour to ride, if bestRideWindow() found one. */
  bestWindow: BestWindow | null;
  /** "Times below use the 16:00 forecast." — null when the selected hour is now. */
  forecastNote: string | null;
  isMobile: boolean;
}

function fmtKm(m: number) {
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
function fmtMin(s: number) {
  return `${Math.round(s / 60)} min`;
}

// Opaque, not frosted: street labels and building fills used to show through the
// body text of this sheet, which outdoors on a phone is a legibility problem before
// it is an aesthetic one. `glass` stays on the small floating wind chip.
const sheet: CSSProperties = {
  ...glass,
  background: "#ffffff",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
};

const quietControl: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  fontFamily: "inherit",
  fontSize: 12,
  cursor: "pointer",
};

export default function RoutePanel({
  active, onToggle, start, end, startLabel, endLabel,
  onPickStart, onPickEnd, onClearStart, onClearEnd, onSwap,
  gpsLoading, gpsError,
  onUseGps, onReset, options, selectedId, onSelect,
  criterion, onCriterion, windIsSimilar, bestWindow, forecastNote, isMobile,
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

  const verdict = verdictFor(options, windIsSimilar, bestWindow);
  const sortingByWind = criterion === "avgWind";

  // Desktop: cap height so the panel (anchored at top:78) never reaches the
  // forecast strip docked bottom-left; it scrolls internally instead.
  return (
    <div style={{ ...sheet, padding: "18px 18px 16px", width: isMobile ? "auto" : 304, maxHeight: isMobile ? "46vh" : "calc(100vh - 210px)", overflowY: "auto" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
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

      {gpsError && <div style={{ fontSize: 11, color: COLORS.bad, marginTop: 8 }}>{gpsError}</div>}
      {(start || end) && (
        <button
          onClick={onReset}
          style={{ ...quietControl, color: COLORS.dim, marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}
        >
          <Icon name="reset" size={13} color={COLORS.faint} />
          Clear all
        </button>
      )}

      {forecastNote && (
        <div style={{ fontSize: 12, color: COLORS.dim, marginBottom: 10 }}>{forecastNote}</div>
      )}

      <div>
        {options.map((o, i) => (
          <button
            key={o.id}
            onClick={() => onSelect(o.id)}
            aria-current={o.id === selectedId || undefined}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              padding: "13px 0",
              borderTopWidth: 0,
              borderRightWidth: 0,
              borderLeftWidth: 0,
              borderBottomWidth: i === options.length - 1 ? 0 : 1,
              borderStyle: "solid",
              borderColor: COLORS.hairline,
              cursor: "pointer",
              fontFamily: "inherit",
              color: COLORS.text,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span
                style={{
                  ...NUM,
                  fontSize: 24,
                  fontWeight: 600,
                  letterSpacing: "-0.025em",
                  lineHeight: 1,
                  color: o.id === selectedId ? COLORS.accent : COLORS.text,
                }}
              >
                {fmtMin(o.metrics.timeS)}
              </span>
              <span style={{ ...NUM, fontSize: 13, color: COLORS.faint, textAlign: "right" }}>
                {fmtKm(o.metrics.distanceM)}
              </span>
            </div>
            <div style={{ ...NUM, fontSize: 12.5, color: COLORS.dim, marginTop: 5 }}>
              {formatWindDelta(o.metrics.windDeltaS)}
            </div>
          </button>
        ))}
      </div>

      {verdict && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.5,
            marginTop: 14,
            paddingTop: 13,
            borderTopWidth: 1,
            borderTopStyle: "solid",
            borderTopColor: COLORS.line,
          }}
        >
          {verdict}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
        <button
          onClick={() => onCriterion(sortingByWind ? "recommended" : "avgWind")}
          aria-pressed={sortingByWind}
          style={{ ...quietControl, color: sortingByWind ? COLORS.accent : COLORS.faint }}
        >
          Sort by wind
        </button>
        {/* Inert until the bike-type picker lands in step 6. */}
        <span style={{ fontSize: 12, color: COLORS.faint }}>Commuter bike, 18 km/h</span>
      </div>
    </div>
  );
}
