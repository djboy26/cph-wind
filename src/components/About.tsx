// src/components/About.tsx
// Methodology + attribution modal. Toggled by a small "i" button in the corner.

import { useState } from "react";

export default function About() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="About this map"
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "none",
          background: "rgba(255,255,255,0.95)",
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
          cursor: "pointer",
          fontSize: 16,
          fontFamily: "Georgia, serif",
          fontStyle: "italic",
          fontWeight: 600,
          color: "#333",
          zIndex: 20,
        }}
      >
        i
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 12,
              maxWidth: 560,
              maxHeight: "85vh",
              overflowY: "auto",
              padding: "24px 28px",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: 14,
              lineHeight: 1.5,
              color: "#222",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>About this map</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{ border: "none", background: "transparent", fontSize: 24, cursor: "pointer", color: "#888", lineHeight: 1, padding: 0 }}
              >×</button>
            </div>

            <p>
              This map shows the wind currently blowing along every street in Greater Copenhagen,
              calculated from regional weather data combined with each street's local building geometry.
              The goal is to give cyclists a fast read on where the wind is helping or hurting before
              they choose a route.
            </p>

            <h3 style={{ fontSize: 15, marginTop: 18, marginBottom: 6 }}>How the wind is calculated</h3>
            <p style={{ margin: "6px 0" }}>
              The regional wind (one value, updated every 10 minutes) comes from Open-Meteo's 10-metre
              forecast. For each street segment, we project that wind onto the street's axis and
              apply an urban canyon model (Soulhac et al., 2008): wind parallel to a street with tall
              flanking buildings is amplified (channeling), wind perpendicular is attenuated
              (skimming flow blocks it at street level). The result is a per-street modified wind
              vector — arrow direction shows where the air is flowing along that street; arrow
              colour shows its magnitude.
            </p>

            <h3 style={{ fontSize: 15, marginTop: 18, marginBottom: 6 }}>What it doesn't model</h3>
            <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
              <li>True spatial wind variation across the city (Open-Meteo gives a single value)</li>
              <li>Gusts at street level (only mean wind is channeled)</li>
              <li>Recirculation behind tall buildings, turbulence, or vortex shedding</li>
              <li>Bridge exposure (e.g. Knippelsbro likely has stronger wind than shown)</li>
            </ul>

            <h3 style={{ fontSize: 15, marginTop: 18, marginBottom: 6 }}>Data quality</h3>
            <p style={{ margin: "6px 0" }}>
              Roads and building footprints come from OpenStreetMap. About 88% of buildings in
              the dataset lack explicit height tags and fall back to type-based estimates (typically
              9 m for residential). The canyon model produces direction variation reliably; magnitude
              estimates carry this height uncertainty.
            </p>

            <h3 style={{ fontSize: 15, marginTop: 18, marginBottom: 6 }}>Data & attribution</h3>
            <ul style={{ margin: "6px 0", paddingLeft: 20, fontSize: 13 }}>
              <li>Road and building geometry: © <a href="https://openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL)</li>
              <li>Weather: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0)</li>
              <li>Vector tiles: <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a></li>
              <li>Map engine: <a href="https://maplibre.org/" target="_blank" rel="noreferrer">MapLibre GL</a>, <a href="https://deck.gl/" target="_blank" rel="noreferrer">deck.gl</a></li>
            </ul>

            <p style={{ fontSize: 12, color: "#777", marginTop: 18, marginBottom: 0 }}>
              Built as a personal project. Source on <a href="https://github.com/djboy26/cph-wind" target="_blank" rel="noreferrer">GitHub</a>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}