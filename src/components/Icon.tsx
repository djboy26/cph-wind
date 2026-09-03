// src/components/Icon.tsx
// One small, consistent stroke-icon set (1.6px, rounded, currentColor) — replaces
// emoji so glyphs render identically on every device and match the UI's weight.

import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "compass"
  | "route"
  | "target"
  | "search"
  | "info"
  | "wind"
  | "close"
  | "reset"
  | "tap"
  | "pin"
  | "swap"
  | "rain"
  | "alert"
  | "sun"
  | "moon";

const PATHS: Record<IconName, ReactNode> = {
  // Navigation arrow inside a ring.
  compass: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <polygon points="15.8 8.2 13.4 13.4 8.2 15.8 10.6 10.6" />
    </>
  ),
  // Two diverging paths with endpoints.
  route: (
    <>
      <circle cx="6" cy="18.5" r="2.4" />
      <circle cx="18" cy="5.5" r="2.4" />
      <path d="M8.2 18.5H13a3.5 3.5 0 0 0 3.5-3.5V8" />
    </>
  ),
  // Locate-me crosshair.
  target: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.8" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  // Flowing wind lines.
  wind: (
    <>
      <path d="M3 8h11a2.6 2.6 0 1 0-2.6-2.6" />
      <path d="M3 12h16a2.6 2.6 0 1 1-2.6 2.6" />
      <path d="M3 16h9.4a2.4 2.4 0 1 1-2.4 2.4" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  reset: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9.5H8.5" />
    </>
  ),
  // Map pin.
  pin: (
    <>
      <path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  // Vertical swap (left arrow down, right arrow up).
  swap: (
    <>
      <path d="M8 4.5v15M8 19.5l-2.5-2.6M8 19.5l2.5-2.6" />
      <path d="M16 19.5v-15M16 4.5l-2.5 2.6M16 4.5l2.5 2.6" />
    </>
  ),
  // Tap / pointer hint.
  tap: (
    <>
      <path d="M9 11V6.5a2 2 0 1 1 4 0V11" />
      <path d="M13 11V9.2a1.8 1.8 0 1 1 3.6 0V14a6 6 0 0 1-6 6h-.7a6 6 0 0 1-4.6-2.2L3 15.2a1.8 1.8 0 0 1 2.7-2.3L7 14" />
    </>
  ),
  // Cloud with falling drops.
  rain: (
    <>
      <path d="M7 15.5a4 4 0 0 1 .4-7.98 5 5 0 0 1 9.5 1.2A3.4 3.4 0 0 1 16.5 15.5z" />
      <path d="M8.5 18l-1 2M12 18l-1 2M15.5 18l-1 2" />
    </>
  ),
  // Warning triangle with an exclamation.
  alert: (
    <>
      <path d="M12 3.6 21 19a1 1 0 0 1-.87 1.5H3.87A1 1 0 0 1 3 19z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="16.8" r="0.5" fill="currentColor" stroke="none" />
    </>
  ),
  // Sun with rays.
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.1 5.1l1.8 1.8M17.1 17.1l1.8 1.8M18.9 5.1l-1.8 1.8M6.9 17.1l-1.8 1.8" />
    </>
  ),
  // Crescent moon.
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" />,
};

interface Props {
  name: IconName;
  size?: number;
  stroke?: number;
  color?: string;
  style?: CSSProperties;
}

export function Icon({ name, size = 18, stroke = 1.6, color = "currentColor", style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "0 0 auto", display: "block", ...style }}
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
