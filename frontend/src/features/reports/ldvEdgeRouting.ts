/**
 * Pure edge-routing engine for the Layered Dependency View.
 *
 * Given oriented (deduplicated, direction-preserving) edges and the absolute
 * center of every card, this module decides which of the 24 named handles each
 * edge attaches to, how far its smoothstep horizontal segment is offset, and
 * where along the path its label prefers to sit. It is deliberately free of
 * React/React Flow rendering concerns so it can be unit-tested and re-run
 * against any set of positions.
 *
 * Port assignment is order-preserving (classic Sugiyama-style): for every
 * node side, incident edges are sorted by the direction toward their other
 * endpoint and given slots left→right in that order. That guarantees two
 * edges leaving the same side of the same card never cross each other at the
 * card border — something the previous greedy per-edge candidate scan could
 * not promise.
 */

import { handleOffset, LDV_HANDLE_FRACTIONS, LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import type { Node } from "@xyflow/react";

export interface XY {
  x: number;
  y: number;
}

export interface NodeBounds {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** A deduplicated edge with its metamodel direction preserved. */
export interface OrientedEdge {
  source: string;
  target: string;
  relLabel: string;
  description?: string;
  /** true when the target is visually above the source (arrow goes upward) */
  flipped: boolean;
  /** flowDirection re-oriented to the relation's metamodel source→target axis */
  flowDirection?: "bidirectional" | "forward" | "reverse";
}

export interface LdvRoute {
  sourceHandle: string;
  targetHandle: string;
  pathOffset: number;
  minOffset: number;
  labelT: number;
}

/**
 * Absolute center of every card node (child positions are relative to their
 * lane group). Works on layout output and on live nodes after a drag alike.
 */
export function computeAbsPos(nodes: Node[]): Map<string, XY> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const abs = new Map<string, XY>();
  for (const n of nodes) {
    if (n.type === "ldvNode" && n.parentId) {
      const parent = byId.get(n.parentId);
      if (parent) {
        abs.set(n.id, {
          x: parent.position.x + n.position.x + LDV_NODE_W / 2,
          y: parent.position.y + n.position.y + LDV_NODE_H / 2,
        });
      }
    }
  }
  return abs;
}

/* ------------------------------------------------------------------ */
/*  Crossing metric                                                    */
/* ------------------------------------------------------------------ */

export interface Segment {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

/**
 * Count pairwise proper crossings of straight handle→handle segments. A good
 * proxy for smoothstep crossings at LDV geometry (near-vertical runs). Shared
 * endpoints (edges meeting at one handle) do not count as crossings. Used as
 * a test acceptance metric, not in routing itself.
 */
export function countEdgeCrossings(segments: Segment[]): number {
  let count = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i];
      const b = segments[j];
      const o1 = orient(a.sx, a.sy, a.tx, a.ty, b.sx, b.sy);
      const o2 = orient(a.sx, a.sy, a.tx, a.ty, b.tx, b.ty);
      const o3 = orient(b.sx, b.sy, b.tx, b.ty, a.sx, a.sy);
      const o4 = orient(b.sx, b.sy, b.tx, b.ty, a.tx, a.ty);
      // Proper crossing only: each segment strictly separates the other's ends.
      if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) count++;
    }
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Port (handle) assignment                                           */
/* ------------------------------------------------------------------ */

/** Prefer side handles only for near-horizontal edges within one lane. */
const SIDE_RATIO = 2.5;

/**
 * Slot patterns for k ≤ 5 attachments on one side: keep them symmetric around
 * the center so a single edge leaves from the middle and a pair leaves from
 * the two inner slots. Order-preserving — index i of the sorted attachment
 * list gets pattern[i].
 */
const CENTERED_SLOTS: readonly (readonly number[])[] = [
  [],
  [3],
  [2, 4],
  [2, 3, 4],
  [1, 2, 4, 5],
  [1, 2, 3, 4, 5],
];

function slotForIndex(i: number, k: number): number {
  if (k <= 5) return CENTERED_SLOTS[k][i];
  // More attachments than slots: spread in order, sharing slots as needed.
  return 1 + Math.round((i * (LDV_HANDLE_FRACTIONS.length - 1)) / (k - 1));
}

interface Attachment {
  edgeIdx: number;
  role: "src" | "tgt";
  selfId: string;
  otherId: string;
}

/* ------------------------------------------------------------------ */
/*  Obstruction check                                                  */
/* ------------------------------------------------------------------ */

/** Check if a vertical-ish line segment from (sx,sy)→(tx,ty) passes through
 *  any node other than sourceId/targetId. For smooth-step paths the horizontal
 *  segment sits near sy or ty, so we check a corridor along the X midpoint.
 *  Returns the required clearance (0 = not obstructed, >0 = half-width of widest obstacle). */
function pathObstruction(
  nodeBounds: NodeBounds[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceId: string,
  targetId: string,
): number {
  const minX = Math.min(sx, tx) - 8;
  const maxX = Math.max(sx, tx) + 8;
  const minY = Math.min(sy, ty);
  const maxY = Math.max(sy, ty);
  let maxClearance = 0;
  for (const b of nodeBounds) {
    if (b.id === sourceId || b.id === targetId) continue;
    if (b.x2 > minX && b.x1 < maxX && b.y2 > minY && b.y1 < maxY) {
      // Compute how far to the side we need to route to clear this node
      const midX = (sx + tx) / 2;
      const halfW = (b.x2 - b.x1) / 2;
      const distFromCenter = Math.abs((b.x1 + b.x2) / 2 - midX);
      const clearance = halfW - distFromCenter + LDV_NODE_W * 0.15; // extra margin
      maxClearance = Math.max(maxClearance, clearance);
    }
  }
  return maxClearance;
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                   */
/* ------------------------------------------------------------------ */

const BASE_OFFSET = 28;
/** Horizontal breathing room between edges sharing one offset level. */
const LEVEL_MARGIN = 24;

export function routeLdvEdges(
  oriented: OrientedEdge[],
  absPos: Map<string, XY>,
  nodeBounds: NodeBounds[],
  groupLabelBounds: Bounds[],
  laneOf: Map<string, string>,
): { routes: LdvRoute[]; usedHandles: Map<string, Set<string>> } {
  const n = oriented.length;
  const srcHandles = new Array<string>(n);
  const tgtHandles = new Array<string>(n);

  /* ---- Step 1: classify each edge and collect side attachments ---- */
  // Physical sides are shared between roles: a card's bottom border carries
  // both `b-N` (it is the source of a downward edge) and `bt-N` (it is the
  // target of an upward edge) at the same positions, so both must be ordered
  // together for the no-crossing guarantee to hold.
  const attachments = new Map<string, Attachment[]>();
  const attach = (nodeId: string, side: "top" | "bottom", a: Attachment) => {
    const key = `${nodeId}|${side}`;
    let list = attachments.get(key);
    if (!list) {
      list = [];
      attachments.set(key, list);
    }
    list.push(a);
  };

  for (let i = 0; i < n; i++) {
    const e = oriented[i];
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    if (!sP || !tP) {
      // Position unknown (defensive): keep the historical center default.
      srcHandles[i] = e.flipped ? "ts-3" : "b-3";
      tgtHandles[i] = e.flipped ? "bt-3" : "t-3";
      continue;
    }
    const dx = tP.x - sP.x;
    const dy = tP.y - sP.y;
    const sameLane = laneOf.get(e.source) === laneOf.get(e.target);

    if (sameLane && Math.abs(dx) > SIDE_RATIO * Math.abs(dy) && dx !== 0) {
      // Near-horizontal edge within one lane: use the facing side handles so
      // the connection renders as a short straight run between the two cards.
      if (dx > 0) {
        srcHandles[i] = "right";
        tgtHandles[i] = "left";
      } else {
        srcHandles[i] = "left-src";
        tgtHandles[i] = "right-tgt";
      }
      continue;
    }

    if (!e.flipped) {
      attach(e.source, "bottom", { edgeIdx: i, role: "src", selfId: e.source, otherId: e.target });
      attach(e.target, "top", { edgeIdx: i, role: "tgt", selfId: e.target, otherId: e.source });
    } else {
      attach(e.source, "top", { edgeIdx: i, role: "src", selfId: e.source, otherId: e.target });
      attach(e.target, "bottom", { edgeIdx: i, role: "tgt", selfId: e.target, otherId: e.source });
    }
  }

  /* ---- Step 2: order attachments per node side, assign slots ---- */
  for (const [key, list] of attachments) {
    const side = key.endsWith("|top") ? "top" : "bottom";
    const sorted = [...list].sort((a, b) => {
      const aSelf = absPos.get(a.selfId)!;
      const aOther = absPos.get(a.otherId)!;
      const bSelf = absPos.get(b.selfId)!;
      const bOther = absPos.get(b.otherId)!;
      // Direction toward the other endpoint: steep edges cluster near the
      // center, shallow ones fan out — dividing by the vertical distance
      // ranks by angle, not just horizontal distance.
      const aKey = (aOther.x - aSelf.x) / Math.max(Math.abs(aOther.y - aSelf.y), 1);
      const bKey = (bOther.x - bSelf.x) / Math.max(Math.abs(bOther.y - bSelf.y), 1);
      if (aKey !== bKey) return aKey - bKey;
      if (aOther.x !== bOther.x) return aOther.x - bOther.x;
      return a.edgeIdx - b.edgeIdx;
    });
    const k = sorted.length;
    for (let i = 0; i < k; i++) {
      const slot = slotForIndex(i, k);
      const a = sorted[i];
      if (side === "bottom") {
        if (a.role === "src") srcHandles[a.edgeIdx] = `b-${slot}`;
        else tgtHandles[a.edgeIdx] = `bt-${slot}`;
      } else {
        if (a.role === "src") srcHandles[a.edgeIdx] = `ts-${slot}`;
        else tgtHandles[a.edgeIdx] = `t-${slot}`;
      }
    }
  }

  /* ---- Step 3: obstruction clearance (slots stay fixed) ---- */
  const endpoints = oriented.map((e, i) => {
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    const sOff = handleOffset(srcHandles[i]);
    const tOff = handleOffset(tgtHandles[i]);
    return {
      sx: (sP?.x ?? 0) + sOff.dx,
      sy: (sP?.y ?? 0) + sOff.dy,
      tx: (tP?.x ?? 0) + tOff.dx,
      ty: (tP?.y ?? 0) + tOff.dy,
    };
  });
  const minOffsets = oriented.map((e, i) => {
    if (!absPos.has(e.source) || !absPos.has(e.target)) return 0;
    const p = endpoints[i];
    return pathObstruction(nodeBounds, p.sx, p.sy, p.tx, p.ty, e.source, e.target);
  });

  /* ---- Step 4: per-gap offset staggering (interval coloring) ---- */
  // Smooth-step paths have a horizontal segment at sourceY + offset (or
  // targetY − offset). Edges crossing the same inter-lane gap share this
  // horizontal band. Edges whose horizontal extents don't overlap can share
  // one offset level; overlapping ones get distinct levels — flatter bundles
  // than giving every edge its own step.
  const edgesByGap = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const gapKey = `${laneOf.get(oriented[i].source) ?? "?"}||${laneOf.get(oriented[i].target) ?? "?"}`;
    let bucket = edgesByGap.get(gapKey);
    if (!bucket) {
      bucket = [];
      edgesByGap.set(gapKey, bucket);
    }
    bucket.push(i);
  }

  const pathOffsets = new Array<number>(n).fill(BASE_OFFSET);
  for (const indices of edgesByGap.values()) {
    if (indices.length <= 1) continue;

    // Minimum handle-to-handle vertical gap among edges in this bucket caps
    // how far offsets may fan out before leaving the inter-lane band.
    let minVertGap = Infinity;
    for (const idx of indices) {
      const sP = absPos.get(oriented[idx].source);
      const tP = absPos.get(oriented[idx].target);
      if (sP && tP) {
        const handleGap = Math.abs(tP.y - sP.y) - LDV_NODE_H;
        minVertGap = Math.min(minVertGap, Math.max(handleGap, 40));
      }
    }
    if (!isFinite(minVertGap)) minVertGap = 200;
    const maxOffset = minVertGap * 0.47;

    // Greedy interval coloring over the horizontal extent of each edge's
    // smoothstep horizontal segment, in deterministic left-to-right order.
    const sorted = [...indices].sort((a, b) => {
      const aStart = Math.min(endpoints[a].sx, endpoints[a].tx);
      const bStart = Math.min(endpoints[b].sx, endpoints[b].tx);
      if (aStart !== bStart) return aStart - bStart;
      const aEnd = Math.max(endpoints[a].sx, endpoints[a].tx);
      const bEnd = Math.max(endpoints[b].sx, endpoints[b].tx);
      if (aEnd !== bEnd) return aEnd - bEnd;
      return a - b;
    });
    const levelEnds: number[] = [];
    const levelOf = new Map<number, number>();
    for (const idx of sorted) {
      const start = Math.min(endpoints[idx].sx, endpoints[idx].tx);
      const end = Math.max(endpoints[idx].sx, endpoints[idx].tx);
      let level = levelEnds.findIndex((last) => last + LEVEL_MARGIN <= start);
      if (level === -1) {
        level = levelEnds.length;
        levelEnds.push(end);
      } else {
        levelEnds[level] = end;
      }
      levelOf.set(idx, level);
    }
    const levels = levelEnds.length;
    const step = levels > 1 ? (maxOffset - BASE_OFFSET) / (levels - 1) : 0;
    for (const idx of sorted) {
      pathOffsets[idx] = BASE_OFFSET + levelOf.get(idx)! * step;
    }
  }

  /* ---- Step 5: label placement (cluster spread + node-overlap nudge) ---- */
  const labelPositions = oriented.map((e, i) => {
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    if (!sP || !tP) return { lx: 0, ly: 0 };
    return { lx: (endpoints[i].sx + endpoints[i].tx) / 2, ly: (endpoints[i].sy + endpoints[i].ty) / 2 };
  });

  const labelOverlapsNode = (lx: number, ly: number, lw: number): boolean => {
    const lh = 20; // label height
    const margin = 4;
    for (const b of nodeBounds) {
      const bx1 = b.x1 - margin,
        by1 = b.y1 - margin;
      const bx2 = b.x2 + margin,
        by2 = b.y2 + margin;
      if (lx - lw / 2 < bx2 && lx + lw / 2 > bx1 && ly - lh / 2 < by2 && ly + lh / 2 > by1)
        return true;
    }
    // Group label areas (category headers like "Business Architecture")
    for (const b of groupLabelBounds) {
      if (
        lx - lw / 2 < b.x2 + margin &&
        lx + lw / 2 > b.x1 - margin &&
        ly - lh / 2 < b.y2 &&
        ly + lh / 2 > b.y1 - margin
      )
        return true;
    }
    return false;
  };

  // Detect label collisions and spread labels along their own paths
  const LABEL_COLLISION_H = 22; // vertical space a label occupies
  const labelTs = new Array<number>(n).fill(0.5);
  const assigned = new Set<number>();
  for (let i = 0; i < labelPositions.length; i++) {
    if (assigned.has(i) || !oriented[i].relLabel) continue;
    const cluster = [i];
    for (let j = i + 1; j < labelPositions.length; j++) {
      if (assigned.has(j) || !oriented[j].relLabel) continue;
      if (
        Math.abs(labelPositions[i].lx - labelPositions[j].lx) < 80 &&
        Math.abs(labelPositions[i].ly - labelPositions[j].ly) < LABEL_COLLISION_H
      ) {
        cluster.push(j);
      }
    }
    if (cluster.length > 1) {
      // Sort cluster by lx (left-to-right) for spatially consistent assignment
      cluster.sort((a, b) => labelPositions[a].lx - labelPositions[b].lx);
      const cn = cluster.length;
      for (let k = 0; k < cn; k++) {
        // Spread labelT within [0.2, 0.8] so labels stay on-path but separated
        labelTs[cluster[k]] = cn === 1 ? 0.5 : 0.2 + (k * 0.6) / (cn - 1);
        assigned.add(cluster[k]);
      }
    }
  }

  // Post-pass: push labels that overlap nodes toward the path midpoint
  for (let i = 0; i < n; i++) {
    if (!oriented[i].relLabel) continue;
    if (!absPos.has(oriented[i].source) || !absPos.has(oriented[i].target)) continue;
    const { sx, sy, tx, ty } = endpoints[i];
    const labelW = Math.min(oriented[i].relLabel.length, 24) * 5.8 + 12;

    // Try current labelT; if it overlaps a node, try shifting toward 0.5
    let t = labelTs[i];
    for (let attempt = 0; attempt < 5; attempt++) {
      // Approximate label position along the smooth step path:
      // For vertical segments, X stays ~constant and Y interpolates
      const lx = sx + (tx - sx) * t;
      const ly = sy + (ty - sy) * t;
      if (!labelOverlapsNode(lx, ly, labelW)) break;
      // Shift toward 0.5 (center of path, farthest from nodes)
      t = t + (0.5 - t) * 0.4;
    }
    labelTs[i] = t;
  }

  /* ---- Assemble ---- */
  const usedHandles = new Map<string, Set<string>>();
  const markUsed = (nodeId: string, handle: string) => {
    let set = usedHandles.get(nodeId);
    if (!set) {
      set = new Set();
      usedHandles.set(nodeId, set);
    }
    set.add(handle);
  };
  const routes: LdvRoute[] = oriented.map((e, i) => {
    markUsed(e.source, srcHandles[i]);
    markUsed(e.target, tgtHandles[i]);
    return {
      sourceHandle: srcHandles[i],
      targetHandle: tgtHandles[i],
      pathOffset: pathOffsets[i],
      minOffset: minOffsets[i],
      labelT: labelTs[i],
    };
  });

  return { routes, usedHandles };
}
