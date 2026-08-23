/**
 * The "double border" that marks an anchor the reader chose on the Layered
 * Dependency View: the card the graph is built around, and the cards they
 * expanded from it with the fork tool.
 *
 * Pure and separate from `LayeredDependencyView.tsx` so the precedence rule is
 * testable — nothing in the suite renders the real LDV, and a component file
 * exporting non-components trips `react-refresh/only-export-components`.
 */

/** Ring widths: the centre dominates, an expanded card echoes it. */
const CENTER_RING_PX = 3;
const EXPANDED_RING_PX = 1.5;

/**
 * Gap between the card's own border and the ring. Without it the two read as
 * one thicker line rather than as a double border, which is the whole point.
 */
const RING_GAP_PX = 2;

export interface LdvFocus {
  /** The card the graph is centred on. */
  isCenter?: boolean;
  /** A card the reader expanded, pulling its relations onto the canvas. */
  isExpanded?: boolean;
}

/**
 * Drawn in the card TYPE's colour, and as an `outline` rather than a thicker
 * border: these are the reader's own bearings, not another semantic state, and
 * the border already carries the timeline grammar (colour for the change state,
 * solid vs dashed for whether the card is in the landscape at all). An outline
 * also sits outside the box model, so node size and edge routing are untouched,
 * and it survives the two things that animate `box-shadow` on this very element
 * — the hover elevation and the timeline pulse.
 *
 * The centre wins when a card is both: one ring, and it is the stronger claim.
 */
export function ldvFocusRing(
  accent: string,
  { isCenter, isExpanded }: LdvFocus,
): { outline: string; outlineOffset: string } | undefined {
  if (!isCenter && !isExpanded) return undefined;
  return {
    outline: `${isCenter ? CENTER_RING_PX : EXPANDED_RING_PX}px solid ${accent}`,
    outlineOffset: `${RING_GAP_PX}px`,
  };
}
