/**
 * Connection-line styles for the Layered Dependency View.
 *
 * The idle look of a relation line is a user preference (View options →
 * Relations), but the set is deliberately a small named list rather than a
 * free-form dash length: in ArchiMate, UML and C4 a line's style is meaningful
 * vocabulary, so a landscape stays readable only while everyone draws from the
 * same short list. Hover and "severed" keep their own fixed styles — they are
 * states, not preferences.
 *
 * Pure module (no React) so the precedence is unit-testable: `LdvEdgeComponent`
 * is not exported and React Flow cannot mount under jsdom.
 */

export type LdvEdgeLineStyle = "solid" | "dotted" | "dashed" | "longDash";

export const LDV_LINE_STYLES: readonly LdvEdgeLineStyle[] = [
  "solid",
  "dotted",
  "dashed",
  "longDash",
] as const;

/** SVG stroke properties for a line style. */
export interface LdvStroke {
  /** `undefined` renders a plain line. */
  strokeDasharray?: string;
  strokeLinecap?: "butt" | "round";
}

/**
 * Idle appearance per style. The dotted preset pairs a very short dash with a
 * ROUND linecap — that is what makes it read as dots; the same array with the
 * default butt cap renders tiny rectangles. Values are tuned for the 1.2px
 * idle stroke and stay coarse enough to survive PNG rasterisation.
 */
const IDLE_STROKE: Record<LdvEdgeLineStyle, LdvStroke> = {
  solid: {},
  dotted: { strokeDasharray: "1 4", strokeLinecap: "round" },
  dashed: { strokeDasharray: "5 3" },
  longDash: { strokeDasharray: "12 5" },
};

/** One endpoint is retired at the viewed date — a state, so it keeps its own
 *  dash regardless of the chosen style (it is also drawn in the error colour). */
const SEVERED_STROKE: LdvStroke = { strokeDasharray: "3 3" };

/**
 * Stroke for one edge. Precedence — severed (a state) beats hover, hover beats
 * the user's idle style. Hovering always renders solid, so the highlight reads
 * the same whichever idle style is in force.
 */
export function ldvEdgeStroke(
  style: LdvEdgeLineStyle | undefined,
  opts: { active?: boolean; severed?: boolean } = {},
): LdvStroke {
  if (opts.severed) return SEVERED_STROKE;
  if (opts.active) return {};
  return IDLE_STROKE[style ?? "dashed"] ?? IDLE_STROKE.dashed;
}
