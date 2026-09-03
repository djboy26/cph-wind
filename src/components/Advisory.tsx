// src/components/Advisory.tsx
// A single, compact safety chip for the current conditions (ice, severe wind,
// gusts, heavy rain). Rendered only when there's something to say, and it stacks
// in the existing top status row so it can never overlap other UI.

import type { Advisory } from "../cyclist/advisory";
import { glass, COLORS, FONT } from "./ui";
import { Icon } from "./Icon";

const LEVEL_COLOR: Record<Advisory["level"], string> = {
  warn: COLORS.bad,
  caution: COLORS.warn,
  info: COLORS.accentInk,
};

export default function AdvisoryChip({ advisory }: { advisory: Advisory }) {
  const color = LEVEL_COLOR[advisory.level];
  return (
    <div
      className="ui-fade"
      role="status"
      style={{
        ...glass,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        maxWidth: "min(92vw, 460px)",
        padding: "7px 13px",
        borderRadius: 999,
        fontFamily: FONT,
        fontSize: 12.5,
        fontWeight: 600,
        color: COLORS.text,
        borderLeft: `3px solid ${color}`,
        pointerEvents: "none",
      }}
    >
      <Icon name={advisory.icon} size={15} color={color} />
      <span>{advisory.text}</span>
    </div>
  );
}
