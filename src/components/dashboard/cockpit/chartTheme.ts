import type { CSSProperties } from "react";

/** Shared recharts <Tooltip> props for the cockpit dark/amber instrument look. */
export const cockpitTooltip = {
  contentStyle: {
    background: "#0D0C0A",
    border: "1px solid var(--amber-dim)",
    borderRadius: 0,
    fontSize: 11,
    fontFamily: "var(--mono)",
    color: "var(--txt)",
    boxShadow: "0 0 0 3px rgba(255,179,36,.08), 0 10px 28px rgba(0,0,0,.6)",
  } as CSSProperties,
  labelStyle: { color: "var(--mut)", letterSpacing: "0.05em" } as CSSProperties,
  itemStyle: { color: "var(--amber-hi)" } as CSSProperties,
};
