// src/components/About.tsx
// Methodology + attribution modal (controlled; trigger lives in the top bar).

import { glass, COLORS, FONT } from "./ui";

const link: React.CSSProperties = { color: COLORS.accent, textDecoration: "none" };
const h3: React.CSSProperties = { fontSize: 15, marginTop: 18, marginBottom: 6, color: COLORS.text };

export default function About({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <>
      {(
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
              maxWidth: 560,
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "24px 28px",
              fontSize: 14,
              lineHeight: 1.55,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: COLORS.text }}>Copenhagen Wind</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", color: COLORS.dim, lineHeight: 1, padding: 0, fontFamily: FONT }}
              >×</button>
            </div>

            <p style={{ color: COLORS.dim }}>
              Live wind blowing along every street in Greater Copenhagen, combining regional weather
              with each street's local building geometry — so cyclists can see where the wind helps or
              hurts, and plan a route around it.
            </p>

            <h3 style={h3}>How the wind is calculated</h3>
            <p style={{ margin: "6px 0", color: COLORS.dim }}>
              The regional wind (one value, refreshed every 10 min) comes from MET Norway's
              Locationforecast (yr.no). For each street, perpendicular rays from the centreline find the
              nearest left/right building walls (from OpenStreetMap footprints), giving the street width
              and flanking wall heights.
            </p>
            <p style={{ margin: "6px 0", color: COLORS.dim }}>
              An urban-canyon model (Soulhac et al., 2008) then channels that wind: flow along the street
              is amplified, flow across it is attenuated. Arrows are confined to the carriageway and
              coloured by a cyclist wind-strength scale; click a street for the head/tailwind impact.
            </p>

            <h3 style={h3}>Accuracy</h3>
            <p style={{ margin: "6px 0", color: COLORS.dim }}>
              The regional input is validated hourly against real observations from DMI weather stations
              and Copenhagen Airport (METAR). The per-street values are a physically-motivated model, not
              a measurement — true street-level wind would need an anemometer on the street.
            </p>

            <h3 style={h3}>Data &amp; attribution</h3>
            <ul style={{ margin: "6px 0", paddingLeft: 20, fontSize: 13, color: COLORS.dim }}>
              <li>Roads &amp; buildings: © <a style={link} href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)</li>
              <li>Weather: <a style={link} href="https://api.met.no/" target="_blank" rel="noreferrer">MET Norway</a> (CC BY 4.0); validation obs <a style={link} href="https://www.dmi.dk/" target="_blank" rel="noreferrer">DMI</a></li>
              <li>Basemap: © <a style={link} href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a></li>
              <li>Engine: <a style={link} href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre GL</a>, <a style={link} href="https://deck.gl/" target="_blank" rel="noreferrer">deck.gl</a></li>
            </ul>

            <p style={{ fontSize: 12, color: COLORS.faint, marginTop: 18, marginBottom: 0 }}>
              Source on <a style={link} href="https://github.com/djboy26/cph-wind" target="_blank" rel="noreferrer">GitHub</a>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
