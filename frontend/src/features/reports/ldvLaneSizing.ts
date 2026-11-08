/**
 * Layer lanes and aggregate boxes that fit their cards (#1295).
 *
 * A layer lane (`ldvGroup`) and an aggregate box (`ldvCluster`) are React Flow
 * parents whose cards are children with `extent: "parent"`. On every drag move
 * the view calls {@link fitParentForDrag}, which refits the box to the union of two
 * rectangles — the box as the layout drew it (its {@link BoxBase}) and the
 * bounding box of all its cards plus the box's insets — the card being
 * dragged included, so the box follows it wherever it goes.
 *
 * So a box grows as a card is dragged past its edge and shrinks back as the
 * card is moved back, but never below its laid-out size: each lane carries
 * `DRAG_ROOM` of spare width on purpose, which a tight fit would take away the
 * moment any card was touched. Every card of the box counts, so pulling one
 * card back never cuts off another one dragged out earlier. There is
 * deliberately no manual resize handle.
 *
 * Moving the origin (growing past the LEFT or TOP edge, or shrinking back from
 * it) moves the box and shifts every child the other way by the same amount,
 * so nothing moves on screen except the border.
 *
 * The card being dragged is the exception, and is not a child while it moves.
 * React Flow keeps its own copy of a dragged node's position relative to its
 * parent, emits a move only when the new relative position differs from that
 * copy, and writes the copy back on release. Shifting the card under it when
 * the origin moves made the copy stale: a card pressed against the left edge
 * read relative x 0 on every move, equal to the copy, so no move was emitted
 * and the box stopped growing, and on release the card jumped by however far
 * the origin had moved. So {@link detachForDrag} takes each dragged card out of
 * its box at drag start (page position, no parent, drawn above everything at
 * {@link DRAGGED_CARD_Z}, the box remembered in `data.dragBoxId`), the refits
 * count it without shifting it, and
 * {@link reattachAfterDrag} puts it back when the drag ends. A page position
 * does not depend on where the box is, so the copy cannot go stale.
 *
 * The laid-out rectangle is stored on the box itself (`data.fitBase`), relative
 * to the box's own origin, because a box can be dragged: its layout coordinates
 * stop meaning anything once it has moved. A re-layout or Reset view rebuilds
 * the nodes and drops it.
 *
 * Pure (no React) so the arithmetic is unit-tested; the live box size is read
 * through {@link boxSize}, the one place that knows a refitted node carries its
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

/**
 * What refitting a box takes: how far its origin moves, and its new size.
 * `dx`/`dy` are signed: positive moves the origin left/up (the box grows past
 * its left/top edge), negative moves it back right/down.
 */
export interface BoxFit extends BoxSize {
  dx: number;
  dy: number;
}

/**
 * The box as the layout drew it, relative to the box's current origin: the
 * floor a refit never goes below. It starts at (0, 0) with the laid-out size
 * and is offset by every move of the origin, so it stays put on screen.
 */
export interface BoxBase {
  x: number;
  y: number;
  w: number;
  h: number;
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
 * A node's current size. `width`/`height` first — where {@link applyBoxFit}
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
 * The box that holds `base` and every child with its insets, or null when the
 * box already is that box. Everything is relative to the box's current origin;
 * the low edges round down and the high edges up, so a card at a fractional
 * drag position always fits.
 */
export function fitBox(
  children: ChildRect[],
  base: BoxBase,
  insets: BoxInsets,
  current: BoxSize,
): BoxFit | null {
  let lowX = base.x;
  let lowY = base.y;
  let highX = base.x + base.w;
  let highY = base.y + base.h;
  for (const c of children) {
    lowX = Math.min(lowX, c.x - insets.left);
    lowY = Math.min(lowY, c.y - insets.top);
    highX = Math.max(highX, c.x + c.w + insets.right);
    highY = Math.max(highY, c.y + c.h + insets.bottom);
  }
  const x0 = Math.floor(lowX);
  const y0 = Math.floor(lowY);
  const width = Math.ceil(highX) - x0;
  const height = Math.ceil(highY) - y0;
  if (x0 === 0 && y0 === 0 && width === current.width && height === current.height) return null;
  // `0 - x` rather than `-x`: negating a zero origin gives -0, which would
  // then leak into node positions.
  return { dx: 0 - x0, dy: 0 - y0, width, height };
}

/**
 * Apply a refit to the node list: the box moves by (-dx, -dy) and takes its
 * new size, and every child of the box moves by (+dx, +dy) so it stays where
 * it was on screen. The size goes on `width`/`height`, on `measured` (so React
 * Flow clamps against the new box on the very next pointer move instead of
 * waiting for its ResizeObserver) and on `style` (which the layout's own
 * readers use); `base`, offset by the same move, goes on `data.fitBase`.
 * Nodes that do not change keep their identity.
 */
export function applyBoxFit(nodes: Node[], boxId: string, fit: BoxFit, base: BoxBase): Node[] {
  const { dx, dy, width, height } = fit;
  const fitBase: BoxBase = { x: base.x + dx, y: base.y + dy, w: base.w, h: base.h };
  return nodes.map((n) => {
    if (n.id === boxId) {
      return {
        ...n,
        position: { x: n.position.x - dx, y: n.position.y - dy },
        width,
        height,
        measured: { width, height },
        style: { ...n.style, width, height },
        data: { ...n.data, fitBase },
      };
    }
    if (n.parentId === boxId && (dx !== 0 || dy !== 0)) {
      return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
    }
    return n;
  });
}

/** What a card carries in `data` while it is dragged out of its box. */
interface DragData {
  dragBoxId?: string;
}

function dragBoxIdOf(n: Node): string | undefined {
  return (n.data as DragData).dragBoxId;
}

/**
 * The stacking order of a card while it is dragged out of its box. React Flow
 * draws a child one level above its parent (z 1) and a top-level node at z 0,
 * so a card taken out of its box would otherwise slide under every other card
 * and box it passes over. No layout sets a `zIndex`, so putting the card back
 * removes it.
 */
export const DRAGGED_CARD_Z = 1000;

/**
 * The ids a drag moves: every node React Flow hands the drag handlers (a
 * selection drags together), or the grabbed node alone when it hands none.
 */
export function dragIds(node: Node, dragged: readonly Node[] | undefined): string[] {
  return dragged && dragged.length > 0 ? dragged.map((n) => n.id) : [node.id];
}

/**
 * Take every dragged card out of the box it sits in, for the length of the
 * drag (see the module comment for why). The card keeps its place on screen:
 * its position becomes the box's position plus its own, which is its page
 * position because boxes are top-level, and it is lifted to
 * {@link DRAGGED_CARD_Z} so it stays on top of what it passes over. Nodes that are not cards in a box —
 * a box itself, the centred card of an aggregate view — are left alone, and
 * the very array comes back when nothing was taken out.
 */
export function detachForDrag(nodes: Node[], ids: readonly string[]): Node[] {
  const dragged = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let changed = false;
  const out = nodes.map((n) => {
    if (!dragged.has(n.id) || !n.parentId) return n;
    const box = byId.get(n.parentId);
    if (!box || box.parentId || !insetsFor(box.type)) return n;
    changed = true;
    return {
      ...n,
      parentId: undefined,
      extent: undefined,
      position: { x: box.position.x + n.position.x, y: box.position.y + n.position.y },
      zIndex: DRAGGED_CARD_Z,
      data: { ...n.data, dragBoxId: box.id },
    };
  });
  return changed ? out : nodes;
}

/**
 * What the view runs on every drag move of a card: refit the card's box to its
 * laid-out rectangle plus all its cards. Returns the very array it was given
 * when nothing has to change, so a drag inside the box costs no re-render. A
 * card with no box (the centred card of an aggregate view) or whose parent is
 * not a box is left alone. A card dragged out of its box by
 * {@link detachForDrag} counts at its page position minus the box's, and is
 * not shifted when the origin moves: it is not a child of the box.
 */
export function fitParentForDrag(nodes: Node[], cardId: string): Node[] {
  const card = nodes.find((n) => n.id === cardId);
  const boxId = card?.parentId ?? (card && dragBoxIdOf(card));
  // No node's id is undefined, so a card without a box finds none here.
  const box = nodes.find((n) => n.id === boxId);
  const insets = insetsFor(box?.type);
  if (!box || !insets) return nodes;
  const size = boxSize(box, 0, 0);
  const base = (box.data as { fitBase?: BoxBase }).fitBase ?? {
    x: 0,
    y: 0,
    w: size.w,
    h: size.h,
  };
  const children: ChildRect[] = [];
  for (const n of nodes) {
    let x: number;
    let y: number;
    if (n.parentId === box.id) {
      x = n.position.x;
      y = n.position.y;
    } else if (!n.parentId && dragBoxIdOf(n) === box.id) {
      x = n.position.x - box.position.x;
      y = n.position.y - box.position.y;
    } else {
      continue;
    }
    const s = boxSize(n, LDV_NODE_W, LDV_NODE_H);
    children.push({ x, y, w: s.w, h: s.h });
  }
  const fit = fitBox(children, base, insets, { width: size.w, height: size.h });
  return fit ? applyBoxFit(nodes, box.id, fit, base) : nodes;
}

/**
 * Put every card {@link detachForDrag} took out back into its box when the
 * drag ends — `parentId`, `extent: "parent"`, a position relative to the
 * box again with the same place on screen, and no `zIndex` — and refit each box once more for
 * the card's final position. A card whose box has gone (the view was re-laid
 * out mid-drag) only loses the marker.
 */
export function reattachAfterDrag(nodes: Node[], ids: readonly string[]): Node[] {
  const dragged = new Set(ids);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // Stryker disable next-line ArrayDeclaration: refitting an id that names no node returns the nodes unchanged
  const back: string[] = [];
  let changed = false;
  let out = nodes.map((n) => {
    const boxId = dragged.has(n.id) && !n.parentId ? dragBoxIdOf(n) : undefined;
    if (!boxId) return n;
    changed = true;
    const data: Record<string, unknown> = { ...n.data };
    delete data.dragBoxId;
    const box = byId.get(boxId);
    if (!box) return { ...n, zIndex: undefined, data };
    back.push(n.id);
    return {
      ...n,
      zIndex: undefined,
      parentId: box.id,
      extent: "parent" as const,
      position: { x: n.position.x - box.position.x, y: n.position.y - box.position.y },
      data,
    };
  });
  if (!changed) return nodes;
  for (const id of back) out = fitParentForDrag(out, id);
  return out;
}
