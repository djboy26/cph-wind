// src/components/OnboardingHint.tsx
// One-time tip shown on first visit, dismissed to localStorage.

import { useState } from "react";
import { glass, COLORS } from "./ui";

const KEY = "cphwind.onboarded.v1";

function seenBefore(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

const TIPS = [
  { icon: "🔍", text: "Zoom in for wind on every street" },
  { icon: "👆", text: "Click a street for headwind / tailwind" },
  { icon: "🧭", text: "Plan a route and compare it by wind" },
];

export default function OnboardingHint({ isMobile }: { isMobile: boolean }) {
  const [show, setShow] = useState(() => !seenBefore());

  if (!show) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div
      className="ui-up"
      style={{
        ...glass,
        position: "absolute",
        bottom: isMobile ? 84 : 22,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        padding: isMobile ? "10px 12px" : "12px 16px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: isMobile ? 8 : 16,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div style={{ display: "flex", gap: isMobile ? 12 : 18, flexWrap: "wrap" }}>
        {TIPS.map((t) => (
          <span key={t.text} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: COLORS.dim, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 15 }}>{t.icon}</span>
            {t.text}
          </span>
        ))}
      </div>
      <button
        className="lift"
        onClick={dismiss}
        style={{
          border: "1px solid rgba(46,124,246,0.5)",
          background: "rgba(46,124,246,0.12)",
          color: "#1a52c9",
          borderRadius: 9,
          padding: "6px 14px",
          fontSize: 12.5,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
        }}
      >
        Got it
      </button>
    </div>
  );
}
