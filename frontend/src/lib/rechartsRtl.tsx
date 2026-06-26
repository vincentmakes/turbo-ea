import React from "react";

interface AxisTickProps {
  x?: string | number;
  y?: string | number;
  payload?: { value?: string | number };
}

/**
 * Custom Recharts axis tick for RTL. The inherited document `direction` flips
 * how SVG `text-anchor` resolves, so the default tick renders the label over the
 * plot/bars instead of outside. This anchors the label just outside a
 * right-side axis (use with `orientation="right"`).
 */
export function makeRtlAxisTick(color: string, fontSize = 12) {
  return function RtlAxisTick(props: AxisTickProps) {
    return (
      <text
        x={Number(props.x ?? 0) + 8}
        y={Number(props.y ?? 0)}
        direction="rtl"
        textAnchor="end"
        dominantBaseline="central"
        fontSize={fontSize}
        fill={color}
      >
        {props.payload?.value ?? ""}
      </text>
    );
  };
}

/**
 * Inline style for a Recharts legend item label. Recharts spaces items with a
 * physical `margin-right` that collapses in RTL; logical inline margins restore
 * the gap (swatch-to-label and item-to-item). LTR keeps the default spacing.
 */
export function rtlLegendItemStyle(isRtl: boolean, color: string): React.CSSProperties {
  return isRtl ? { color, marginInlineStart: 4, marginInlineEnd: 16 } : { color };
}

/** Tooltip content-style additions so tooltip text reads RTL. */
export function rtlTooltipStyle(isRtl: boolean): React.CSSProperties {
  return { direction: isRtl ? "rtl" : "ltr", textAlign: isRtl ? "right" : "left" };
}

/** Mirror a Recharts chart `margin` left/right for RTL. */
export function mirrorChartMargin<T extends { left?: number; right?: number }>(
  margin: T,
  isRtl: boolean,
): T {
  return isRtl ? { ...margin, left: margin.right, right: margin.left } : margin;
}
