// src/components/OnboardingHint.tsx
// One-time tip shown on first visit, dismissed to localStorage.

import { useState } from "react";
import { glass, pillActive, COLORS } from "./ui";
import { Icon, type IconName } from "./Icon";

const KEY = "cphwind.onboarded.v1";

function seenBefore(): boolean {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

const TIPS: { icon: IconName; text: string }[] = [
  { icon: "search", text: "Zoom in for arrows on every street" },
  { icon: "tap", text: "Tap a street for headwind / tailwind" },
  { icon: "route", text: "Plan a route and compare it by wind" },
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
        // Centred on screen via inset+auto margins (no transform, so it neither fights
        // the ui-up animation nor depends on the bottom panels' sizes — it simply can't
        // overlap them). One-time, dismissed with "Got it".
        inset: 0,
        margin: "auto",
        width: "fit-content",
        height: "fit-content",
        zIndex: 40,
        padding: isMobile ? "12px 14px" : "12px 16px",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "stretch" : "center",
        gap: isMobile ? 8 : 16,
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <div style={{ display: "flex", gap: isMobile ? 12 : 18, flexWrap: "wrap" }}>
        {TIPS.map((t) => (
          <span key={t.text} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: COLORS.dim, whiteSpace: "nowrap" }}>
            <Icon name={t.icon} size={16} color={COLORS.accent} />
            {t.text}
          </span>
        ))}
      </div>
      <button
        className="lift"
        onClick={dismiss}
        style={{
          ...pillActive,
          borderRadius: 10,
          padding: "7px 16px",
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: "nowrap",
        }}
      >
        Got it
      </button>
    </div>
  );
}
