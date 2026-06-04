// src/components/SegmentTooltip.tsx
import type { GeometrySource } from "../math";
import { windBand, streetImpact, type RGB } from "../cyclist/windCategory";

interface Props {
  x: number;
  y: number;
  streetName: string | null;
  modifiedSpeedMs: number;
  travelDeg: number;
  /** Street axis A→B, deg CW from N — needed for head/tailwind decomposition. */
  bearingDeg: number;
  canyonH: number;
  canyonW: number;
  leftHeightM: number;
  rightHeightM: number;
  geometrySource: GeometrySource;
  laneIndex: number;
  laneCount: number;
  variant: "cursor" | "sheet";
  onClose?: () => void;
}

function compassPoint(deg: number): string {
  const points = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return points[Math.round(deg / 45) % 8];
}

function rgbCss(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function Chip({ color, label }: { color: RGB; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: rgbCss(color), flex: "0 0 auto" }} />
      <span style={{ fontWeight: 600 }}>{label}</span>
    </span>
  );
}

const SOURCE_LABELS: Record<GeometrySource, string> = {
  measured: "measured from building walls",
  partial: "partial (one open side)",
  fallback: "estimated (no nearby walls)",
};

export default function SegmentTooltip({
  x, y, streetName, modifiedSpeedMs, travelDeg, bearingDeg, canyonH, canyonW,
  leftHeightM, rightHeightM, geometrySource, laneIndex, laneCount,
  variant, onClose,
}: Props) {
  const strength = windBand(modifiedSpeedMs);
  const impact = streetImpact(modifiedSpeedMs, travelDeg, bearingDeg);
  const lambda = canyonW > 0 ? canyonH / canyonW : 0;
  const regime =
    lambda < 0.1 ? "no canyon (open)" :
    lambda < 0.3 ? "shallow canyon" :
    lambda < 0.7 ? "moderate canyon" :
    "deep canyon (skimming flow)";

  const positionStyle =
    variant === "sheet"
      ? { left: 8, right: 8, bottom: 8 }
      : { left: x + 14, top: y + 14, maxWidth: 280 };

  return (
    <div
      style={{
        position: "absolute",
        pointerEvents: variant === "sheet" ? "auto" : "none",
        background: "rgba(255,255,255,0.97)",
        borderRadius: 10,
        padding: "12px 14px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 13,
        color: "#222",
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        minWidth: 200,
        zIndex: 50,
        ...positionStyle,
      }}
    >
      {variant === "sheet" && onClose && (
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 6, right: 6,
            border: "none", background: "transparent",
            fontSize: 20, color: "#888", cursor: "pointer",
            width: 28, height: 28, lineHeight: 1,
          }}
          aria-label="Close"
        >×</button>
      )}
      <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
        {streetName ?? "Unnamed segment"}
      </div>
      {laneCount > 1 && (
        <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
          Lane {laneIndex + 1} of {laneCount}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: "#666" }}>Wind on street</span>
        <span>
          <span style={{ fontWeight: 600 }}>{modifiedSpeedMs.toFixed(1)} m/s</span>
          <span style={{ marginLeft: 6 }}><Chip color={strength.color} label={strength.label} /></span>
        </span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ color: "#666" }}>Blowing toward</span>
        <span>{compassPoint(travelDeg)} ({Math.round(travelDeg)}°)</span>
      </div>

      {/* Route impact: head/tailwind for each direction of travel */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee", fontSize: 12 }}>
        <div style={{ color: "#888", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
          For your route
        </div>
        {impact.alongMs < 0.5 ? (
          <div style={{ color: "#666" }}>
            Crosswind — little head/tailwind either way ({impact.alongMs.toFixed(1)} m/s along the street).
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ color: "#666" }}>Riding {compassPoint(impact.favorableBearingDeg)}</span>
              <Chip color={impact.favorable.color} label={`${impact.favorable.label} ${impact.alongMs.toFixed(1)}`} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#666" }}>Riding {compassPoint((impact.favorableBearingDeg + 180) % 360)}</span>
              <Chip color={impact.against.color} label={`${impact.against.label} ${impact.alongMs.toFixed(1)}`} />
            </div>
          </>
        )}
      </div>

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #eee", fontSize: 11, color: "#666" }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Left wall H</span><span>{leftHeightM.toFixed(0)} m</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Right wall H</span><span>{rightHeightM.toFixed(0)} m</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Street width W</span><span>{canyonW.toFixed(1)} m</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>λ = H/W</span><span>{lambda.toFixed(2)}</span>
        </div>
        <div style={{ marginTop: 4, fontStyle: "italic" }}>{regime}</div>
        <div style={{ marginTop: 4, fontSize: 10, color: "#999" }}>
          Cross-section: {SOURCE_LABELS[geometrySource]}
        </div>
      </div>
    </div>
  );
}
