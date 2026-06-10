// src/components/TimeSlider.tsx
// Scrub the wind forecast for the next ~24h. Drives the whole map (arrows, routing,
// top bar) for the selected hour. [0] = now.
//
// The strip layers three time-based signals a cyclist weighs together, without
// adding any new on-screen panels:
//   • wind        — the headline number (+ gust) for the selected hour
//   • rain        — a per-hour precipitation profile behind the slider
//   • daylight    — dark hours are shaded (a moon flags "you'll need lights")
//   • best window — a tappable marker on the calmest/driest upcoming hour

import type { ForecastStep } from "../api/weather";
import type { RideWindow } from "../cyclist/bestWindow";
import { isDark } from "../cyclist/solar";
import { glass, COLORS, NUM, label as labelStyle, FONT } from "./ui";
import { Icon } from "./Icon";

interface Props {
  steps: ForecastStep[];
  index: number;
  onChange: (i: number) => void;
  isMobile: boolean;
  /** Location for the local sunrise/sunset shading. */
  lat: number;
  lon: number;
  rideWindow?: RideWindow | null;
}

const RAIN_FULL_MM = 4; // precip at/above this fills the bar height
const RAIN_COLOR = "rgba(47,106,240,0.55)";
const NIGHT_TINT = "rgba(40,52,86,0.13)";

function stepLabel(steps: ForecastStep[], index: number): string {
  if (index <= 0) return "Now";
  const base = new Date(steps[0].time).getTime();
  const t = new Date(steps[index].time);
  const h = Math.round((t.getTime() - base) / 3600000);
  const hhmm = t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${hhmm} · +${h}h`;
}

function hhmm(time: string): string {
  return new Date(time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function TimeSlider({ steps, index, onChange, isMobile, lat, lon, rideWindow }: Props) {
  if (steps.length < 2) return null;
  const n = steps.length;
  const i = Math.max(0, Math.min(index, n - 1));
  const cur = steps[i];
  const spd = cur.wind.speedMs;
  const gust = cur.wind.gustMs;
  const temp = cur.conditions.tempC;
  const rain = cur.conditions.precipMm ?? 0;
  const isNow = i === 0;
  const dark = steps.map((s) => isDark(new Date(s.time), lat, lon));
  const curDark = dark[i];

  // Position (0–1) of a step under the slider thumb's travel.
  const frac = (idx: number) => (n <= 1 ? 0 : idx / (n - 1));

  return (
    <div style={{ ...glass, padding: isMobile ? "9px 13px 7px" : "10px 15px 8px", width: isMobile ? "auto" : 320 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
        <span style={labelStyle}>Wind forecast</span>
        <span style={{ ...NUM, fontSize: 12.5, color: COLORS.dim, display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ color: isNow ? COLORS.accentInk : COLORS.text, fontWeight: 700 }}>{stepLabel(steps, i)}</span>
          <span>
            <span style={{ fontWeight: 700, color: COLORS.text }}>{spd.toFixed(1)}</span> m/s
          </span>
          {gust != null && gust - spd >= 2 && <span style={{ color: COLORS.faint }}>gust {gust.toFixed(0)}</span>}
          {temp != null && <span style={{ color: COLORS.text }}>{Math.round(temp)}°</span>}
          {rain > 0 && <span style={{ color: COLORS.accentInk }}>{rain.toFixed(1)}mm</span>}
          {curDark && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: COLORS.faint }}>
              <Icon name="moon" size={11} color={COLORS.faint} /> lights
            </span>
          )}
        </span>
      </div>

      {/* Rain profile + daylight shading. Cells map 1:1 to slider steps. */}
      <div style={{ position: "relative", height: 18, marginBottom: 2 }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", gap: 1, borderRadius: 4, overflow: "hidden" }}>
          {steps.map((s, idx) => {
            const p = s.conditions.precipMm ?? 0;
            const hPct = p > 0 ? Math.max(14, Math.min(100, (p / RAIN_FULL_MM) * 100)) : 0;
            return (
              <div
                key={idx}
                style={{
                  flex: 1,
                  position: "relative",
                  background: dark[idx] ? NIGHT_TINT : "transparent",
                  display: "flex",
                  alignItems: "flex-end",
                }}
              >
                {hPct > 0 && <div style={{ width: "100%", height: `${hPct}%`, background: RAIN_COLOR, borderRadius: "2px 2px 0 0" }} />}
              </div>
            );
          })}
        </div>
        {/* Best-window marker. */}
        {rideWindow && (
          <div
            style={{
              position: "absolute",
              top: -2,
              left: `${frac(rideWindow.index) * 100}%`,
              transform: "translateX(-50%)",
              color: COLORS.good,
              lineHeight: 1,
              pointerEvents: "none",
            }}
            aria-hidden
          >
            ▾
          </div>
        )}
      </div>

      <input
        type="range"
        min={0}
        max={n - 1}
        value={i}
        step={1}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Forecast time"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={i}
        aria-valuetext={stepLabel(steps, i)}
        style={{ width: "100%", accentColor: COLORS.accent, cursor: "pointer", margin: 0, fontFamily: FONT }}
      />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: COLORS.faint, marginTop: 1, minHeight: 16 }}>
        <span>Now</span>
        {rideWindow ? (
          <button
            onClick={() => onChange(rideWindow.index)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "1px 7px",
              borderRadius: 999,
              border: `1px solid ${COLORS.line}`,
              background: "rgba(31,157,87,0.10)",
              color: COLORS.good,
              fontSize: 10.5,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: FONT,
              whiteSpace: "nowrap",
            }}
            title="Jump to this hour"
          >
            <Icon name="sun" size={11} color={COLORS.good} />
            Best {hhmm(steps[rideWindow.index].time)} · {rideWindow.reason}
          </button>
        ) : (
          <span />
        )}
        <span>+{n - 1}h</span>
      </div>
    </div>
  );
}
