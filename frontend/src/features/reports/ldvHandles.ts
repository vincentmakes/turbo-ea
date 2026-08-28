/**
 * Single source of truth for the Layered Dependency View's handle geometry.
 *
 * The 24 handles per card (5 slots on top + bottom, each with a source/target
 * mirror, plus one source + one target per side) used to be declared twice —
 * as JSX `left: "12%"` styles in the view and as `±0.38 * W` offsets in the
 * layout's routing math — and the two had to be kept in sync by hand. Both
 * now derive from this table: the view renders `<Handle>`s by mapping
 * LDV_HANDLE_SPECS, the routing math calls handleOffset().
 */

export const LDV_NODE_W = 200;
/**
 * Tall enough for a logo's band plus a two-line name at the card's FULL width:
 * 30px of band + 2 × 18.2px of name + a 16.4px caption = 82.8px inside an 83px
 * content box.
 *
 * The narrower alternative — keep 72px and have the name wrap in the space
 * beside the logo — was measured and is worse than doing nothing: a 200px card
 * leaves ~124px between the mark and the corner icons, which breaks a name like
 * "Salesforce Customer Community" after its second word. Height is what buys a
 * long name its width back.
 *
 * Deliberately **not** conditional on whether logos are switched on. The logo
 * toggle patches already-positioned nodes precisely so it does not disturb a
 * reader's drags (see `cardDisplayData`), and a height that changed with it
 * would force a relayout on every flip.
 */
export const LDV_NODE_H = 86;

/** Horizontal positions of the 5 top/bottom slots, as a fraction of node width. */
export const LDV_HANDLE_FRACTIONS = [0.12, 0.3, 0.5, 0.7, 0.88] as const;

export interface LdvHandleSpec {
  id: string;
  side: "top" | "bottom" | "left" | "right";
  kind: "source" | "target";
  /** Position along the side: fraction of node width (top/bottom) or height (sides). */
  frac: number;
}

function slotSpecs(
  side: "top" | "bottom",
  kind: "source" | "target",
  prefix: string,
): LdvHandleSpec[] {
  return LDV_HANDLE_FRACTIONS.map((frac, i) => ({
    id: `${prefix}${i + 1}`,
    side,
    kind,
    frac,
  }));
}

/**
 * All 24 handles. Mirrors (`ts-N`, `bt-N`) exist so an upward ("flipped") edge
 * can exit the top of its source and enter the bottom of its target while
 * React Flow still sees a source-typed and a target-typed handle.
 */
export const LDV_HANDLE_SPECS: LdvHandleSpec[] = [
  ...slotSpecs("top", "target", "t-"),
  ...slotSpecs("top", "source", "ts-"),
  ...slotSpecs("bottom", "source", "b-"),
  ...slotSpecs("bottom", "target", "bt-"),
  { id: "left", side: "left", kind: "target", frac: 0.5 },
  { id: "left-src", side: "left", kind: "source", frac: 0.5 },
  { id: "right", side: "right", kind: "source", frac: 0.5 },
  { id: "right-tgt", side: "right", kind: "target", frac: 0.5 },
];

const SPEC_BY_ID = new Map(LDV_HANDLE_SPECS.map((s) => [s.id, s]));

/** Offset of a handle from the node's center, in canvas pixels. */
export function handleOffset(id: string): { dx: number; dy: number } {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) return { dx: 0, dy: 0 };
  switch (spec.side) {
    case "top":
      return { dx: (spec.frac - 0.5) * LDV_NODE_W, dy: -LDV_NODE_H / 2 };
    case "bottom":
      return { dx: (spec.frac - 0.5) * LDV_NODE_W, dy: LDV_NODE_H / 2 };
    case "left":
      return { dx: -LDV_NODE_W / 2, dy: (spec.frac - 0.5) * LDV_NODE_H };
    case "right":
      return { dx: LDV_NODE_W / 2, dy: (spec.frac - 0.5) * LDV_NODE_H };
  }
}

/**
 * A handle's position on the card as {x, y} fractions of the card's box —
 * mxGraph's `exitX/exitY` / `entryX/entryY` vocabulary, so the DrawIO diagram
 * generated from a view attaches its edges exactly where the view does.
 * Lives here so the fractions still have one home.
 */
export function handleAnchor(id: string): { x: number; y: number } | null {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) return null;
  switch (spec.side) {
    case "top":
      return { x: spec.frac, y: 0 };
    case "bottom":
      return { x: spec.frac, y: 1 };
    case "left":
      return { x: 0, y: spec.frac };
    case "right":
      return { x: 1, y: spec.frac };
  }
}
