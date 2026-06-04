// src/components/ui.ts
// Shared design tokens for the "Daylight" light-glass UI so every floating panel
// matches — a warm, airy Apple-Maps-daytime palette with frosted white cards.

import type { CSSProperties } from "react";

export const COLORS = {
  text: "#1c2733",   // ink
  dim: "#566273",
  faint: "#8a93a1",
  line: "rgba(28,39,51,0.10)",
  accent: "#2e7cf6", // Apple blue
  good: "#1f9d57",
  warn: "#d98324",
  bad: "#e0533d",
  chipBg: "rgba(28,39,51,0.05)",
};

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Frosted white card — the base look for every floating panel. */
export const glass: CSSProperties = {
  background: "rgba(255,255,255,0.74)",
  backdropFilter: "blur(18px) saturate(1.6)",
  WebkitBackdropFilter: "blur(18px) saturate(1.6)",
  border: "1px solid rgba(255,255,255,0.7)",
  borderRadius: 16,
  boxShadow: "0 12px 36px rgba(40,52,74,0.16), 0 1px 0 rgba(255,255,255,0.8) inset",
  color: COLORS.text,
  fontFamily: FONT,
};

/** Compact pill button used in controls. */
export const pill: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: `1px solid ${COLORS.line}`,
  background: "rgba(28,39,51,0.045)",
  color: COLORS.text,
  cursor: "pointer",
  fontSize: 13,
  fontFamily: FONT,
  transition: "background 120ms ease, border-color 120ms ease",
};

export const pillActive: CSSProperties = {
  ...pill,
  background: "rgba(46,124,246,0.12)",
  borderColor: "rgba(46,124,246,0.5)",
  color: "#1a52c9",
  fontWeight: 600,
};
