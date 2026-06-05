// src/components/ui.ts
// The design system for the floating "Daylight" UI. One calm, Scandinavian-minded
// language — restrained ink, frosted-white surfaces, a single accent, tabular
// numerals, and a strict spacing/radius/elevation rhythm so every panel agrees.

import type { CSSProperties } from "react";

// Inter (loaded in index.html) with a sturdy system fallback.
export const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Calm Nordic ink against the warm "Copenhagen Morning" map. Surfaces are frosted
// white; the accent is a single composed blue used sparingly for what's live/active.
export const COLORS = {
  text: "#16202b",   // cool near-black ink
  dim: "#586573",
  faint: "#929cab",
  line: "rgba(20,32,43,0.10)",
  hairline: "rgba(20,32,43,0.06)",
  accent: "#2f6af0",
  accentInk: "#1c4fd0",
  accentWash: "rgba(47,106,240,0.10)",
  accentLine: "rgba(47,106,240,0.42)",
  good: "#1f9d57",
  warn: "#cf871d",
  bad: "#e0533d",
  chipBg: "rgba(20,32,43,0.045)",
};

// 4px base rhythm — every gap/padding is a multiple, so spacing reads intentional.
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
export const RADIUS = { sm: 10, md: 14, lg: 18, pill: 999 } as const;

// Layered elevation: a tight contact shadow + a soft ambient one. No single heavy blur.
export const SHADOW = {
  card: "0 1px 2px rgba(20,32,43,0.06), 0 10px 30px rgba(20,32,43,0.13)",
  pop: "0 2px 8px rgba(20,32,43,0.10), 0 22px 52px rgba(20,32,43,0.20)",
};

// Standard motion curve — decisive out, gentle settle.
export const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

// Tabular lining figures so live numbers (wind m/s, km, min) don't jitter on update.
export const NUM: CSSProperties = {
  fontVariantNumeric: "tabular-nums",
  fontFeatureSettings: '"tnum" 1',
};

// Small uppercase section label (Rank by, Wind on street, …).
export const label: CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.9,
  color: COLORS.faint,
};

/** Frosted white card — the base look for every floating panel. */
export const glass: CSSProperties = {
  background: "rgba(255,255,255,0.72)",
  backdropFilter: "blur(20px) saturate(1.7)",
  WebkitBackdropFilter: "blur(20px) saturate(1.7)",
  border: "1px solid rgba(255,255,255,0.66)",
  borderRadius: RADIUS.lg,
  boxShadow: SHADOW.card,
  color: COLORS.text,
  fontFamily: FONT,
};

/** Compact pill button used in controls. */
export const pill: CSSProperties = {
  padding: "7px 13px",
  borderRadius: RADIUS.sm,
  border: `1px solid ${COLORS.line}`,
  background: "rgba(20,32,43,0.04)",
  color: COLORS.text,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  fontFamily: FONT,
  letterSpacing: -0.1,
  transition: `background 160ms ${EASE}, border-color 160ms ${EASE}, color 160ms ${EASE}, transform 140ms ${EASE}`,
};

export const pillActive: CSSProperties = {
  ...pill,
  background: COLORS.accentWash,
  borderColor: COLORS.accentLine,
  color: COLORS.accentInk,
  fontWeight: 600,
};
