/**
 * Shared PPM layout tokens.
 *
 * `KPI_VALUE_SX` styles the large currency figures in the Overview and Cost
 * summary blocks. The `md` font size equals `h6`'s default, so desktop renders
 * unchanged; the `xs` shrink buys the headroom a long formatted amount needs.
 * `overflowWrap` is the safety valve — these must never be truncated, because
 * an ellipsised currency amount is misleading rather than merely ugly.
 */
export const KPI_VALUE_SX = {
  fontSize: { xs: "1.05rem", md: "1.25rem" },
  lineHeight: 1.3,
  overflowWrap: "anywhere" as const,
};
