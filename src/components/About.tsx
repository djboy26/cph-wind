// src/components/About.tsx
// Methodology + attribution modal (controlled; trigger lives in the top bar).

import { glass, COLORS, FONT, label } from "./ui";
import { Icon } from "./Icon";

const link: React.CSSProperties = { color: COLORS.accent, textDecoration: "none", fontWeight: 500 };
const section: React.CSSProperties = { ...label, display: "block", marginTop: 20, marginBottom: 8 };
const para: React.CSSProperties = { margin: "0 0 10px", color: COLORS.dim };

export default function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      className="ui-fade"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,31,43,0.4)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="ui-up thin-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...glass,
          maxWidth: 540,
          maxHeight: "85vh",
          overflowY: "auto",
          padding: "22px 26px 26px",
          fontSize: 14,
          lineHeight: 1.55,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            paddingBottom: 14,
            borderBottom: `1px solid ${COLORS.hairline}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.3, color: COLORS.text }}>Copenhagen Wind</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="lift"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, borderRadius: "50%", border: "none", background: "transparent", cursor: "pointer", fontFamily: FONT }}
          >
            <Icon name="close" size={17} color={COLORS.dim} />
          </button>
        </div>

        <p style={{ margin: 0, color: COLORS.text, fontSize: 14.5, lineHeight: 1.5 }}>
          Live wind along every street in Greater Copenhagen. It combines the regional weather with each
          street's building geometry, so you can see where the wind helps or hurts and plan around it.
        </p>

        <div style={section}>How the wind is calculated</div>
        <p style={para}>
          The regional wind comes from MET Norway (yr.no) and refreshes every 10&nbsp;minutes. For each
          street we take its width and the height of the buildings on either side, read from OpenStreetMap.
        </p>
        <p style={para}>
          An urban canyon model (Soulhac et al., 2008) then channels that wind down the street: wind
          flowing along the street speeds up, wind across it dies down, and in a deep street it turns back
          on itself near the ground. Arrows stay on the carriageway and
          are coloured by a cyclist wind scale. Tap a street to see its head or tailwind.
        </p>

        <div style={section}>Accuracy</div>
        <p style={para}>
          The regional input is checked every hour against real observations from DMI stations and
          Copenhagen Airport (METAR). The per-street values are a model, not a measurement. True
          street level wind would need an anemometer on the spot.
        </p>

        <div style={section}>Data &amp; attribution</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: COLORS.dim, lineHeight: 1.7 }}>
          <li>Roads &amp; buildings: © <a style={link} href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> (ODbL)</li>
          <li>Weather: <a style={link} href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a> (CC BY 4.0); validation <a style={link} href="https://www.dmi.dk/" target="_blank" rel="noreferrer">DMI</a></li>
          <li>Basemap: © <a style={link} href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></li>
          <li>Engine: <a style={link} href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre GL</a> · <a style={link} href="https://deck.gl/" target="_blank" rel="noreferrer">deck.gl</a></li>
        </ul>

        <p style={{ fontSize: 12, color: COLORS.faint, marginTop: 18, marginBottom: 0 }}>
          Source on <a style={link} href="https://github.com/djboy26/cph-wind" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </div>
    </div>
  );
}
