// src/components/ui.ts
// Shared design tokens for the dark "glass" UI so every floating panel matches.

import type { CSSProperties } from "react";

export const COLORS = {
  text: "#eef0f3",
  dim: "#aeb4bf",
  faint: "#7c828d",
  line: "rgba(255,255,255,0.09)",
  accent: "#5b9dff",
  good: "#46d18a",
  warn: "#ffb36b",
  bad: "#ff7a66",
  chipBg: "rgba(255,255,255,0.06)",
};

export const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Frosted dark card — the base look for every floating panel. */
export const glass: CSSProperties = {
  background: "rgba(17,19,24,0.72)",
  backdropFilter: "blur(16px) saturate(1.4)",
  WebkitBackdropFilter: "blur(16px) saturate(1.4)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  boxShadow: "0 10px 34px rgba(0,0,0,0.5)",
  color: COLORS.text,
  fontFamily: FONT,
};

/** Compact pill button used in controls. */
export const pill: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 10,
  border: `1px solid ${COLORS.line}`,
  background: "rgba(255,255,255,0.04)",
  color: COLORS.text,
  cursor: "pointer",
  fontSize: 13,
  fontFamily: FONT,
  transition: "background 120ms ease, border-color 120ms ease",
};

export const pillActive: CSSProperties = {
  ...pill,
  background: "rgba(91,157,255,0.18)",
  borderColor: "rgba(91,157,255,0.55)",
  color: "#dce9ff",
  fontWeight: 600,
};
