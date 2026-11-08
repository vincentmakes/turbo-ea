/**
 * Layer lanes and aggregate boxes that grow with their cards (#1295).
 *
 * A layer lane (`ldvGroup`) and an aggregate box (`ldvCluster`) are React Flow
 * parents whose cards are children with `extent: "parent"`, so React Flow
 * clamps a dragged card inside its box. The box therefore has to grow *before*
 * the card reaches its edge: while a card is dragged, the view calls
 * {@link growParentForDrag}, which enlarges the box whenever the card comes
 * within the box's inset of an edge. React Flow keeps clamping — just against
 * the larger box on the next pointer move — so `extent` stays in force and a
 * card can never escape its layer; the box simply follows it outward. Boxes
 * never shrink, and there is deliberately no manual resize handle.
 *
 * Growing past the LEFT or TOP edge moves the box and shifts every child the
 * other way by the same amount, so nothing moves on screen except the border —
 * exactly what React Flow's own `expandParent` does, but with the inset kept,
 * so a card never ends up flush against the border or under the lane's title.
 *
 * Pure (no React) so the arithmetic is unit-tested; the live box size is read
 * through {@link boxSize}, the one place that knows a grown node carries its
 * size on `width`/`height` as well as on `style`.
 */
import type { Node } from "@xyflow/react";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import { LABEL_H, PAD } from "./ldvLayoutShared";
import { CL_HEADER_H, CL_PAD } from "./ldvAggregate";

/** How far a card is kept from each edge of the box it sits in. */
export interface BoxInsets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A rectangle relative to its box's top-left corner. */
export interface ChildRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoxSize {
  width: number;
  height: number;
}

/** What growing a box takes: how far its origin moves left/up, and its new size. */
export interface BoxGrowth extends BoxSize {
  dx: number;
  dy: number;
}

/** A layer lane: the layout's own padding on three sides, the title strip on top. */
export const LANE_INSETS: BoxInsets = { left: PAD, top: LABEL_H, right: PAD, bottom: PAD };

/** An aggregate box: its padding on three sides, its header on top. */
export const CLUSTER_INSETS: BoxInsets = {
  left: CL_PAD,
  top: CL_HEADER_H,
  right: CL_PAD,
  bottom: CL_PAD,
};

/** The insets for a box node type, or undefined for a node that holds no cards. */
export function insetsFor(type: string | undefined): BoxInsets | undefined {
  if (type === "ldvGroup") return LANE_INSETS;
  if (type === "ldvCluster") return CLUSTER_INSETS;
  return undefined;
}

/**
 * A node's current size. `width`/`height` first — where {@link applyBoxGrowth}
 * writes, and where React Flow itself puts a measured size — then the size the
 * layout put on `style`, then the fallback.
 */
export function boxSize(n: Node, fallbackW: number, fallbackH: number): { w: number; h: number } {
  return {
    w: n.width ?? (n.style?.width as number | undefined) ?? fallbackW,
    h: n.height ?? (n.style?.height as number | undefined) ?? fallbackH,
  };
}

/**
 * The box a card needs, or null when it already fits. `child` is relative to
 * the box; the result grows the box so the card sits at least `insets` inside
 * every edge — moving the origin left/up (`dx`/`dy`) when the card crossed the
 * left/top inset, widening/heightening it when it crossed the right/bottom one.
 * Never smaller than the box already is.
 */
export function growBoxToFit(
  child: ChildRect,
  box: BoxSize,
  insets: BoxInsets,
): BoxGrowth | null {
  const dx = Math.max(0, Math.ceil(insets.left - child.x));
  const dy = Math.max(0, Math.ceil(insets.top - child.y));
  const width = Math.max(box.width + dx, Math.ceil(child.x + dx + child.w + insets.right));
  const height = Math.max(box.height + dy, Math.ceil(child.y + dy + child.h + insets.bottom));
  if (dx === 0 && dy === 0 && width === box.width && height === box.height) return null;
  return { dx, dy, width, height };
}

/**
 * Apply a growth to the node list: the box moves by (-dx, -dy) and takes its
 * new size, and every child of the box moves by (+dx, +dy) so it stays where
 * it was on screen. The size goes on `width`/`height`, on `measured` (so React
 * Flow clamps against the new box on the very next pointer move instead of
 * waiting for its ResizeObserver) and on `style` (which the layout's own
 * readers use). Nodes that do not change keep their identity.
 */
export function applyBoxGrowth(nodes: Node[], boxId: string, growth: BoxGrowth): Node[] {
  const { dx, dy, width, height } = growth;
  return nodes.map((n) => {
    if (n.id === boxId) {
      return {
        ...n,
        position: { x: n.position.x - dx, y: n.position.y - dy },
        width,
        height,
        measured: { width, height },
        style: { ...n.style, width, height },
      };
    }
    if (n.parentId === boxId && (dx !== 0 || dy !== 0)) {
      return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
    }
    return n;
  });
}

/**
 * What the view runs on every drag move of a card: grow the card's box when the
 * card has come within the box's inset of an edge. Returns the very array it
 * was given when nothing has to change, so a drag inside the box costs no
 * re-render. A card with no parent (the centred card of an aggregate view) or a
 * parent that is not a box is left alone.
 */
export function growParentForDrag(nodes: Node[], cardId: string): Node[] {
  const card = nodes.find((n) => n.id === cardId);
  if (!card?.parentId) return nodes;
  const box = nodes.find((n) => n.id === card.parentId);
  const insets = insetsFor(box?.type);
  if (!box || !insets) return nodes;
  const size = boxSize(box, 0, 0);
  const cardSize = boxSize(card, LDV_NODE_W, LDV_NODE_H);
  const growth = growBoxToFit(
    { x: card.position.x, y: card.position.y, w: cardSize.w, h: cardSize.h },
    { width: size.w, height: size.h },
    insets,
  );
  return growth ? applyBoxGrowth(nodes, box.id, growth) : nodes;
}
