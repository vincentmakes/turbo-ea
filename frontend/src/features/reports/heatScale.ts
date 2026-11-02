/**
 * The continuous heat scales the Capability Map and Process Map paint a cell
 * with: each runs from a pale end (no value) to a deep end (the largest value)
 * and a cell's shade is the straight mix of the two at its share of the range.
 * The ends are design tokens, so a scale re-tunes with the palette rather than
 * carrying its own colour arithmetic.
 */
import { alpha } from "@mui/material/styles";
import {
  CHART_SEQUENTIAL,
  RAG_COLORS,
  SEVERITY_COLORS,
  STATUS_COLORS,
  surface,
} from "@/theme/tokens";

export const HEAT_SCALES = {
  /** A count or an amount, where more is simply more — the sequential blue. */
  amount: CHART_SEQUENTIAL.light,
  /** Risk, where more is worse: paper to the critical red. */
  risk: [surface.light.paper, SEVERITY_COLORS.critical],
  /** Maturity or automation, where more is better: paper to the healthy green. */
  better: [surface.light.paper, RAG_COLORS.green],
} as const;

export type HeatScale = keyof typeof HEAT_SCALES;

/** A cell with nothing to measure (every value equal, or none at all). */
export const HEAT_EMPTY = alpha(STATUS_COLORS.neutral, 0.1);

/** `#rgb` or `#rrggbb` as its three channels. */
function channels(hex: string): [number, number, number] {
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((d) => d + d)
          .join("")
      : hex.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** The colour `ratio` (0 → `from`, 1 → `to`) of the way between two hex colours, as `#rrggbb`. */
export function mixHex(from: string, to: string, ratio: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * ratio)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** A cell's shade on `scale` at `ratio` (0 palest … 1 deepest). */
export function heatShade(scale: HeatScale, ratio: number): string {
  const [from, to] = HEAT_SCALES[scale];
  return mixHex(from, to, ratio);
}
