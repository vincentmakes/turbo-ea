import type { Node } from "@xyflow/react";
import { absolutePosition } from "./ldvEdgeRouting";
import { LDV_NODE_W, LDV_NODE_H } from "./layeredDependencyLayout";

/**
 * Obstacle boxes (cards + group-label strips) that edge labels must avoid.
 *
 * Computed once per render in the view and shared with every edge through
 * context. Previously each edge recomputed this from the full node list with a
 * `.find()` inside the loop — O(E·N²) on every drag frame.
 */
export interface ObstacleBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Height of the label strip across the top of a group box. */
export const GROUP_LABEL_STRIP_H = 34;

export function computeObstacles(nodeList: Node[]): ObstacleBounds[] {
  const byId = new Map(nodeList.map((n) => [n.id, n]));
  const bounds: ObstacleBounds[] = [];
  for (const n of nodeList) {
    if (n.type === "ldvNode" && n.parentId) {
      const w = (n.style?.width as number) ?? LDV_NODE_W;
      const h = (n.style?.height as number) ?? LDV_NODE_H;
      // Through the whole chain: in aggregate mode a card sits inside a type
      // box inside a lane, and one level of flattening puts its obstacle box
      // in the wrong place.
      const { x: ax, y: ay } = absolutePosition(n, byId);
      bounds.push({ x1: ax, y1: ay, x2: ax + w, y2: ay + h });
    } else if (n.type === "ldvCluster") {
      // The WHOLE box, not just its title strip: an aggregate connector may
      // cross a box it does not belong to, and its count must not come to rest
      // inside one — a number floating among a box's cards reads as belonging
      // to them.
      const w = (n.style?.width as number) ?? 0;
      const h = (n.style?.height as number) ?? 0;
      const { x: ax, y: ay } = absolutePosition(n, byId);
      bounds.push({ x1: ax, y1: ay, x2: ax + w, y2: ay + h });
    } else if (n.type === "ldvGroup") {
      // Group label strip across the top of the box.
      const gx = n.position.x;
      const gy = n.position.y;
      const gw = (n.style?.width as number) ?? 0;
      bounds.push({ x1: gx, y1: gy, x2: gx + gw, y2: gy + GROUP_LABEL_STRIP_H });
    }
  }
  return bounds;
}
