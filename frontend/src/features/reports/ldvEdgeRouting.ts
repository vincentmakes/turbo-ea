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

import {
  handleAnchor,
  handleOffset,
  LDV_HANDLE_FRACTIONS,
  LDV_NODE_W,
  LDV_NODE_H,
} from "./ldvHandles";
import { buildRowBands, buildChannel, type ChannelXY, type ChannelCard } from "./ldvChannels";
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
  /** The relation type this line stands for — one line per type, so this is
   *  unambiguous. `"hierarchy"` for the synthetic parent/child lines. */
  relType?: string;
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
  /**
   * Explicit y for the edge's horizontal run, passed to getSmoothStepPath as
   * `centerY`. Staggered so overlapping runs never share a line, and nudged
   * off card bodies. Unset for side-handle edges, for obstructed edges that
   * keep the legacy offset-driven shape, and for channel-routed edges.
   */
  centerY?: number;
  /**
   * Channel route: bend points of an orthogonal polyline (endpoints
   * excluded) for an edge that had to dodge rows of cards between its
   * endpoints. Mutually exclusive with centerY.
   */
  waypoints?: ChannelXY[];
  /** Layout-time handle points, so the renderer can detect staleness after
   *  a drag and fall back to the default shape. */
  anchors?: { sx: number; sy: number; tx: number; ty: number };
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

/** Slot x-offsets from the node center, one per handle fraction. */
const SLOT_OFFSETS = LDV_HANDLE_FRACTIONS.map((f) => (f - 0.5) * LDV_NODE_W);

/**
 * Straightness-seeking, order-preserving slot assignment: attachments keep
 * their sorted order (slots strictly increasing — the no-crossing guarantee),
 * but each pays |slot offset − ideal Δx toward its partner|, minimized
 * exactly by a tiny DP. A partner card standing in the same column therefore
 * gets the aligned slot and a dead-straight edge, even when sibling edges
 * share the side. Ties resolve to the smaller slots (deterministic). With
 * more attachments than slots, they spread in order, sharing slots.
 */
function assignSlotsByIdeal(ideals: number[]): number[] {
  const k = ideals.length;
  const m = SLOT_OFFSETS.length;
  if (k > m) {
    return ideals.map((_, i) => 1 + Math.round((i * (m - 1)) / (k - 1)));
  }
  const dp: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(Infinity));
  const choice: number[][] = Array.from({ length: k }, () => new Array<number>(m).fill(-1));
  for (let s = 0; s < m; s++) dp[0][s] = Math.abs(SLOT_OFFSETS[s] - ideals[0]);
  for (let i = 1; i < k; i++) {
    for (let s = i; s < m; s++) {
      let best = Infinity;
      let bi = -1;
      for (let p = i - 1; p < s; p++) {
        if (dp[i - 1][p] < best) {
          best = dp[i - 1][p];
          bi = p;
        }
      }
      dp[i][s] = best + Math.abs(SLOT_OFFSETS[s] - ideals[i]);
      choice[i][s] = bi;
    }
  }
  let s = k - 1;
  let bestCost = Infinity;
  for (let cand = k - 1; cand < m; cand++) {
    if (dp[k - 1][cand] < bestCost) {
      bestCost = dp[k - 1][cand];
      s = cand;
    }
  }
  const slots = new Array<number>(k);
  for (let i = k - 1; i >= 0; i--) {
    slots[i] = s + 1;
    s = choice[i][s];
  }
  return slots;
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
  // Edges routed through top/bottom handles (false: side handles / fallback)
  const vertical = new Array<boolean>(n).fill(false);
  // Card pairs that have already claimed the single side-handle route.
  const sideRouted = new Set<string>();
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
      //
      // Only the FIRST edge of a card pair may take this route. Several relation
      // types can connect the same two cards, and the side handles are a single
      // fixed point per side — a second edge taking them would be drawn exactly
      // on top of the first. The rest fall through to the vertical path, where
      // the slot allocator below gives each its own handle.
      const pairKey =
        e.source < e.target ? `${e.source}||${e.target}` : `${e.target}||${e.source}`;
      if (!sideRouted.has(pairKey)) {
        sideRouted.add(pairKey);
        if (dx > 0) {
          srcHandles[i] = "right";
          tgtHandles[i] = "left";
        } else {
          srcHandles[i] = "left-src";
          tgtHandles[i] = "right-tgt";
        }
        continue;
      }
    }

    vertical[i] = true;
    if (!e.flipped) {
      attach(e.source, "bottom", { edgeIdx: i, role: "src", selfId: e.source, otherId: e.target });
      attach(e.target, "top", { edgeIdx: i, role: "tgt", selfId: e.target, otherId: e.source });
    } else {
      attach(e.source, "top", { edgeIdx: i, role: "src", selfId: e.source, otherId: e.target });
      attach(e.target, "bottom", { edgeIdx: i, role: "tgt", selfId: e.target, otherId: e.source });
    }
  }

  /* ---- Step 2: order attachments per node side, assign slots ---- */
  // Slot tables are kept per node side so the vertical de-overlap pass below
  // can move a handle to an adjacent free slot without breaking the
  // left-to-right order this step guarantees.
  interface SlotEntry {
    edgeIdx: number;
    role: "src" | "tgt";
    slot: number;
  }
  const sideEntries = new Map<string, SlotEntry[]>();
  // Per edge: the side-table key each vertical end belongs to ("" = side/none)
  const srcSideKey = new Array<string>(n).fill("");
  const tgtSideKey = new Array<string>(n).fill("");

  const handleId = (side: "top" | "bottom", role: "src" | "tgt", slot: number): string => {
    if (side === "bottom") return role === "src" ? `b-${slot}` : `bt-${slot}`;
    return role === "src" ? `ts-${slot}` : `t-${slot}`;
  };

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
    const ideals = sorted.map((a) => {
      const self = absPos.get(a.selfId)!;
      const other = absPos.get(a.otherId)!;
      return Math.max(SLOT_OFFSETS[0], Math.min(SLOT_OFFSETS[SLOT_OFFSETS.length - 1], other.x - self.x));
    });
    const slots = assignSlotsByIdeal(ideals);
    const entries: SlotEntry[] = [];
    for (let i = 0; i < k; i++) {
      const slot = slots[i];
      const a = sorted[i];
      entries.push({ edgeIdx: a.edgeIdx, role: a.role, slot });
      if (a.role === "src") {
        srcHandles[a.edgeIdx] = handleId(side, "src", slot);
        srcSideKey[a.edgeIdx] = key;
      } else {
        tgtHandles[a.edgeIdx] = handleId(side, "tgt", slot);
        tgtSideKey[a.edgeIdx] = key;
      }
    }
    sideEntries.set(key, entries);
  }

  /* ---- Step 3: obstruction clearance (slots stay fixed) ---- */
  const computeEndpoint = (i: number) => {
    const e = oriented[i];
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
  };
  const endpoints = oriented.map((_, i) => computeEndpoint(i));
  const minOffsets = oriented.map((e, i) => {
    if (!absPos.has(e.source) || !absPos.has(e.target)) return 0;
    const p = endpoints[i];
    return pathObstruction(nodeBounds, p.sx, p.sy, p.tx, p.ty, e.source, e.target);
  });

  /* ---- Step 3.5: channel-route edges that must cross rows of cards ---- */
  // The DrawIO-inspired piece: an edge whose endpoints have whole rows of
  // cards between them (a lane-skipping edge, or a source/target that is not
  // in its lane's edge row) picks ONE corridor free through every crossed
  // row and connects each end to it as cheaply as possible — straight when
  // aligned, through the card's side (one bend) when the corridor runs
  // directly beside it, or with a jog in the adjacent gap. A single corridor
  // is what prevents staircase paths.
  const waypointsArr = new Array<ChannelXY[] | undefined>(n);
  const jogRunsMeta: { edge: number; wpIndex: number; lo: number; hi: number }[] = [];
  {
    const bands = buildRowBands(nodeBounds);
    const boundsById = new Map(nodeBounds.map((b) => [b.id, b]));
    const rowIdxOf = (id: string): number => {
      const b = boundsById.get(id);
      if (!b) return -1;
      return bands.findIndex((band) => b.y1 >= band.y1 - 1 && b.y1 <= band.y2);
    };
    const cardOf = (id: string): ChannelCard => {
      const b = boundsById.get(id)!;
      return { x1: b.x1, x2: b.x2, cy: (b.y1 + b.y2) / 2 };
    };
    const reservations = new Map<number, number[]>();
    // At most one side connection per card side, so two horizontals never
    // coincide on a card's center line.
    const claimedSides = new Set<string>();
    for (let i = 0; i < n; i++) {
      if (!vertical[i]) continue;
      const e = oriented[i];
      if (!absPos.has(e.source) || !absPos.has(e.target)) continue;
      const p = endpoints[i];
      const minY = Math.min(p.sy, p.ty);
      const maxY = Math.max(p.sy, p.ty);
      const idxs: number[] = [];
      for (let b = 0; b < bands.length; b++) {
        if (bands[b].y1 > minY + 4 && bands[b].y2 < maxY - 4) idxs.push(b);
      }
      if (idxs.length === 0) continue;
      if (p.ty < p.sy) idxs.reverse(); // upward edge walks bottom→top
      const plan = buildChannel({
        sx: p.sx,
        sy: p.sy,
        tx: p.tx,
        ty: p.ty,
        bands,
        betweenIdxs: idxs,
        srcRowIdx: rowIdxOf(e.source),
        tgtRowIdx: rowIdxOf(e.target),
        srcCard: cardOf(e.source),
        tgtCard: cardOf(e.target),
        sides: {
          exitLeft: !claimedSides.has(`${e.source}|left`),
          exitRight: !claimedSides.has(`${e.source}|right`),
          entryLeft: !claimedSides.has(`${e.target}|left`),
          entryRight: !claimedSides.has(`${e.target}|right`),
        },
        reservations,
      });
      if (plan.kind === "none") {
        // Straight column verified clear through every crossed row — never
        // the legacy wrap-around shape.
        minOffsets[i] = 0;
        continue;
      }
      // Side connections re-anchor the edge onto the card's side handle.
      if (plan.exit === "side-left" || plan.exit === "side-right") {
        srcHandles[i] = plan.exit === "side-left" ? "left-src" : "right";
        srcSideKey[i] = ""; // no longer in a top/bottom slot table
        claimedSides.add(`${e.source}|${plan.exit === "side-left" ? "left" : "right"}`);
      }
      if (plan.entry === "side-left" || plan.entry === "side-right") {
        tgtHandles[i] = plan.entry === "side-left" ? "left" : "right-tgt";
        tgtSideKey[i] = "";
        claimedSides.add(`${e.target}|${plan.entry === "side-left" ? "left" : "right"}`);
      }
      endpoints[i] = computeEndpoint(i);
      waypointsArr[i] = plan.waypoints;
      for (const j of plan.jogs) {
        jogRunsMeta.push({ edge: i, wpIndex: j.wpIndex, lo: j.lo, hi: j.hi });
      }
      minOffsets[i] = 0;
    }
  }

  /* ---- Step 4: place each edge's horizontal run (explicit centerY) ---- */
  // getSmoothStepPath puts the horizontal segment of an opposite top/bottom
  // handle pair at the MIDPOINT of the two handle Ys — its `offset` parameter
  // does not move it. So edges whose endpoints share rows all lay their
  // horizontal runs on exactly the same line, reading as one merged wire.
  // Instead we pass an explicit `centerY` per edge: runs that overlap
  // horizontally are interval-colored, spread across their shared band, and
  // nudged off card bodies. The path keeps its two bends — only the y of the
  // horizontal run moves.
  const STUB = 16; // minimum vertical stub out of a handle
  const Y_SEP = 16; // separation between staggered horizontal runs
  const X_TOUCH = 12; // runs closer than this in x read as overlapping

  const centerYs = new Array<number | undefined>(n).fill(undefined);

  interface HRun {
    idx: number;
    x1: number; // extent of the horizontal run
    x2: number;
    lo: number; // feasible y range for the run
    hi: number;
    mid: number; // default (midpoint) position
    /** When set, this run is a channel jog: the y writes into
     *  waypoints[idx][wp] and [wp+1] instead of centerYs[idx]. */
    wp?: number;
  }
  const runs: HRun[] = [];
  for (let i = 0; i < n; i++) {
    if (!vertical[i] || waypointsArr[i]) continue;
    const p = endpoints[i];
    const lo = Math.min(p.sy, p.ty) + STUB;
    const hi = Math.max(p.sy, p.ty) - STUB;
    if (hi - lo < 4) continue;
    runs.push({
      idx: i,
      x1: Math.min(p.sx, p.tx),
      x2: Math.max(p.sx, p.tx),
      lo,
      hi,
      mid: (p.sy + p.ty) / 2,
    });
  }
  // Channel jogs are horizontal runs too: they cluster and stagger together
  // with the ordinary edges sharing their gap.
  for (const j of jogRunsMeta) {
    const wps = waypointsArr[j.edge]!;
    const a = wps[j.wpIndex];
    const b = wps[j.wpIndex + 1];
    runs.push({
      idx: j.edge,
      x1: Math.min(a.x, b.x),
      x2: Math.max(a.x, b.x),
      lo: j.lo,
      hi: j.hi,
      mid: (j.lo + j.hi) / 2,
      wp: j.wpIndex,
    });
  }

  const applyRunY = (r: HRun, y: number) => {
    const v = Math.min(Math.max(y, r.lo), r.hi);
    if (r.wp !== undefined) {
      const wps = waypointsArr[r.idx]!;
      wps[r.wp] = { ...wps[r.wp], y: v };
      wps[r.wp + 1] = { ...wps[r.wp + 1], y: v };
    } else {
      centerYs[r.idx] = v;
    }
  };

  // Nudge a run's y off any card — or lane label strip — its span crosses.
  const runObstacles: Bounds[] = [...nodeBounds, ...groupLabelBounds];
  const clearRunY = (desired: number, x1: number, x2: number, lo: number, hi: number): number => {
    const hits = (y: number) =>
      runObstacles.some((b) => b.x2 > x1 - 4 && b.x1 < x2 + 4 && y > b.y1 - 6 && y < b.y2 + 6);
    if (!hits(desired)) return desired;
    let best = desired;
    let bestDist = Infinity;
    for (const b of runObstacles) {
      if (b.x2 <= x1 - 4 || b.x1 >= x2 + 4) continue;
      for (const cand of [b.y1 - 10, b.y2 + 10]) {
        if (cand < lo || cand > hi || hits(cand)) continue;
        const dist = Math.abs(cand - desired);
        if (dist < bestDist) {
          bestDist = dist;
          best = cand;
        }
      }
    }
    return best;
  };

  // Cluster runs whose x-extents and feasible bands overlap (union-find).
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < runs.length; a++) {
    for (let b = a + 1; b < runs.length; b++) {
      const xGap = Math.max(runs[a].x1, runs[b].x1) - Math.min(runs[a].x2, runs[b].x2);
      const yOverlap = Math.min(runs[a].hi, runs[b].hi) - Math.max(runs[a].lo, runs[b].lo);
      if (xGap < X_TOUCH && yOverlap > 0) parent[find(a)] = find(b);
    }
  }
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < runs.length; i++) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(i);
  }

  for (const memberIdxs of clusters.values()) {
    const members = memberIdxs.map((i) => runs[i]);
    if (members.length === 1) {
      const r = members[0];
      applyRunY(r, clearRunY(r.mid, r.x1, r.x2, r.lo, r.hi));
      continue;
    }
    // Interval coloring: runs whose x-extents don't overlap share a level
    // (and therefore a y), overlapping ones get distinct levels. Levels key
    // by the run object — one channel edge can contribute several jog runs.
    const order = [...members].sort(
      (a, b) => a.x1 - b.x1 || a.x2 - b.x2 || a.idx - b.idx || (a.wp ?? -1) - (b.wp ?? -1),
    );
    const levelEnds: number[] = [];
    const levelOf = new Map<HRun, number>();
    for (const r of order) {
      let level = levelEnds.findIndex((last) => last + X_TOUCH <= r.x1);
      if (level === -1) {
        level = levelEnds.length;
        levelEnds.push(r.x2);
      } else {
        levelEnds[level] = r.x2;
      }
      levelOf.set(r, level);
    }
    const levels = levelEnds.length;
    // Spread the levels around the center of the shared band. Pairwise
    // overlap doesn't guarantee a common intersection across the whole
    // cluster, so fall back to the union when the intersection is empty.
    const bandLo = Math.max(...members.map((r) => r.lo));
    const bandHi = Math.min(...members.map((r) => r.hi));
    const usableLo = bandLo <= bandHi ? bandLo : Math.min(...members.map((r) => r.lo));
    const usableHi = bandLo <= bandHi ? bandHi : Math.max(...members.map((r) => r.hi));
    const step = levels > 1 ? Math.min(Y_SEP, (usableHi - usableLo) / (levels - 1)) : 0;
    const base = (usableLo + usableHi) / 2 - (step * (levels - 1)) / 2;
    const levelY = new Array<number>(levels);
    for (let lv = 0; lv < levels; lv++) {
      const lvRuns = members.filter((r) => levelOf.get(r) === lv);
      const x1 = Math.min(...lvRuns.map((r) => r.x1));
      const x2 = Math.max(...lvRuns.map((r) => r.x2));
      levelY[lv] = clearRunY(base + lv * step, x1, x2, usableLo, usableHi);
    }
    for (const r of members) {
      applyRunY(r, levelY[levelOf.get(r)!]);
    }
  }

  // A pinned run only helps if the resulting three-segment path is actually
  // clear of cards. A vertical that would cut through a card cannot be fixed
  // by moving the horizontal run, so such edges fall back to the legacy
  // obstruction shape (minOffset-driven wrap-around) instead — while an edge
  // whose only problem was the horizontal run keeps its nudged centerY and
  // drops the legacy fallback.
  const vertClear = (x: number, yA: number, yB: number, skipA: string, skipB: string) => {
    const y1 = Math.min(yA, yB);
    const y2 = Math.max(yA, yB);
    return !nodeBounds.some(
      (b) =>
        b.id !== skipA &&
        b.id !== skipB &&
        x > b.x1 - 2 &&
        x < b.x2 + 2 &&
        Math.min(y2, b.y2) - Math.max(y1, b.y1) > 2,
    );
  };
  for (const r of runs) {
    if (r.wp !== undefined) continue; // jog runs are clear by construction
    const y = centerYs[r.idx];
    if (y === undefined) continue;
    const e = oriented[r.idx];
    const p = endpoints[r.idx];
    const horizontalClear = !nodeBounds.some(
      (b) =>
        b.id !== e.source &&
        b.id !== e.target &&
        b.x2 > r.x1 - 4 &&
        b.x1 < r.x2 + 4 &&
        y > b.y1 - 2 &&
        y < b.y2 + 2,
    );
    if (
      horizontalClear &&
      vertClear(p.sx, p.sy, y, e.source, e.target) &&
      vertClear(p.tx, y, p.ty, e.source, e.target)
    ) {
      minOffsets[r.idx] = 0;
    } else {
      centerYs[r.idx] = undefined;
    }
  }

  /* ---- Step 5: de-overlap collinear vertical runs (slot nudges) ---- */
  // Column alignment makes cards stack vertically, so two edges routinely put
  // a vertical run at exactly the same x through the same y-range — reading
  // as one wire. Where that happens, move one edge's handle to an adjacent
  // free slot. A move is allowed only when it keeps the handle strictly
  // between its neighbours in the side's slot table, so the left-to-right
  // no-crossing order from Step 2 is preserved.
  const V_EPS = 6; // same-x tolerance for "collinear"
  const V_MIN_OVERLAP = 12;

  interface VSeg {
    x: number;
    y1: number;
    y2: number;
    /** Which handle can move to resolve a conflict; null = a fixed corridor
     *  segment of a channel edge (other edges must move instead). */
    end: "src" | "tgt" | null;
  }
  const segsOf = (i: number): VSeg[] => {
    const p = endpoints[i];
    const wps = waypointsArr[i];
    if (wps && wps.length > 0) {
      const pts = [{ x: p.sx, y: p.sy }, ...wps, { x: p.tx, y: p.ty }];
      const segs: VSeg[] = [];
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k];
        const b = pts[k + 1];
        if (Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) > 0.01) {
          segs.push({
            x: a.x,
            y1: Math.min(a.y, b.y),
            y2: Math.max(a.y, b.y),
            end: k === 0 ? "src" : k + 2 === pts.length ? "tgt" : null,
          });
        }
      }
      return segs;
    }
    const y = centerYs[i];
    if (y === undefined) return [];
    if (Math.abs(p.sx - p.tx) < 1) {
      return [{ x: p.sx, y1: Math.min(p.sy, p.ty), y2: Math.max(p.sy, p.ty), end: "src" }];
    }
    return [
      { x: p.sx, y1: Math.min(p.sy, y), y2: Math.max(p.sy, y), end: "src" },
      { x: p.tx, y1: Math.min(y, p.ty), y2: Math.max(y, p.ty), end: "tgt" },
    ];
  };

  const tryShift = (i: number, end: "src" | "tgt"): boolean => {
    const key = end === "src" ? srcSideKey[i] : tgtSideKey[i];
    if (!key) return false;
    const entries = sideEntries.get(key)!;
    // More attachments than slots — slots are shared and packed, nothing to move.
    if (entries.length > LDV_HANDLE_FRACTIONS.length) return false;
    const pos = entries.findIndex((en) => en.edgeIdx === i && en.role === end);
    if (pos === -1) return false;
    const prevSlot = pos > 0 ? entries[pos - 1].slot : 0;
    const nextSlot =
      pos < entries.length - 1 ? entries[pos + 1].slot : LDV_HANDLE_FRACTIONS.length + 1;
    const cur = entries[pos].slot;
    for (const cand of [cur + 1, cur - 1]) {
      if (cand <= prevSlot || cand >= nextSlot) continue;
      entries[pos] = { ...entries[pos], slot: cand };
      const side = key.endsWith("|top") ? "top" : "bottom";
      const id = handleId(side, end, cand);
      if (end === "src") srcHandles[i] = id;
      else tgtHandles[i] = id;
      endpoints[i] = computeEndpoint(i);
      // A channel polyline starts/ends at the handle x — keep it attached.
      const wps = waypointsArr[i];
      if (wps && wps.length > 0) {
        if (end === "src") wps[0] = { ...wps[0], x: endpoints[i].sx };
        else wps[wps.length - 1] = { ...wps[wps.length - 1], x: endpoints[i].tx };
      }
      return true;
    }
    return false;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const findConflict = () => {
        for (const a of segsOf(i)) {
          for (const b of segsOf(j)) {
            if (
              Math.abs(a.x - b.x) < V_EPS &&
              Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > V_MIN_OVERLAP
            ) {
              return { a, b };
            }
          }
        }
        return null;
      };
      let conflict = findConflict();
      let guard = 0;
      while (conflict && guard++ < 3) {
        const shiftedB = conflict.b.end !== null && tryShift(j, conflict.b.end);
        const shiftedA =
          !shiftedB && conflict.a.end !== null && tryShift(i, conflict.a.end);
        if (!shiftedB && !shiftedA) break;
        conflict = findConflict();
      }
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
    const wps = waypointsArr[i];
    return {
      sourceHandle: srcHandles[i],
      targetHandle: tgtHandles[i],
      pathOffset: BASE_OFFSET,
      minOffset: minOffsets[i],
      labelT: labelTs[i],
      ...(centerYs[i] !== undefined ? { centerY: centerYs[i] } : {}),
      ...(wps && wps.length > 0
        ? {
            waypoints: wps,
            anchors: {
              sx: endpoints[i].sx,
              sy: endpoints[i].sy,
              tx: endpoints[i].tx,
              ty: endpoints[i].ty,
            },
          }
        : {}),
    };
  });

  return { routes, usedHandles };
}

/* ------------------------------------------------------------------ */
/*  Export                                                             */
/* ------------------------------------------------------------------ */

export interface ExportRouteInput {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  /** Live absolute centres of the two cards (post-drag). */
  sourceCentre?: XY;
  targetCentre?: XY;
  /** Routing the layout computed, off the edge's data. */
  waypoints?: XY[];
  centerY?: number;
  anchors?: { sx: number; sy: number; tx: number; ty: number };
}

export interface ExportRoute {
  exit?: { x: number; y: number };
  entry?: { x: number; y: number };
  waypoints?: XY[];
}

/** How far a live handle may sit from its layout-time anchor before the stored
 *  route counts as stale. Mirrors the renderer's own tolerance. */
const EXPORT_STALE_PX = 4;

/**
 * Translate one routed edge into the anchors and bend points a generated
 * diagram needs, so an exported diagram keeps the path the view drew.
 *
 * Three shapes come out of the router and all three are handled: a channel
 * route carries explicit `waypoints`; an ordinary edge carries a `centerY`,
 * whose two bends are re-derived here; anything else (a side-handle run, a
 * legacy obstructed edge) contributes anchors only and is left to the diagram
 * to route.
 *
 * Positions are live while the stored route is from layout time, so a dragged
 * card would otherwise export bends that no longer meet its edges. When the
 * two disagree the bends are dropped and only the anchors travel — the same
 * bargain the renderer strikes.
 */
export function exportRoute(input: ExportRouteInput): ExportRoute {
  const { sourceHandle, targetHandle, sourceCentre, targetCentre } = input;
  const exit = sourceHandle ? (handleAnchor(sourceHandle) ?? undefined) : undefined;
  const entry = targetHandle ? (handleAnchor(targetHandle) ?? undefined) : undefined;
  if (!sourceCentre || !targetCentre) return { exit, entry };

  const sOff = handleOffset(sourceHandle ?? "");
  const tOff = handleOffset(targetHandle ?? "");
  const sx = sourceCentre.x + sOff.dx;
  const sy = sourceCentre.y + sOff.dy;
  const tx = targetCentre.x + tOff.dx;
  const ty = targetCentre.y + tOff.dy;

  const a = input.anchors;
  const fresh =
    !a ||
    (Math.abs(a.sx - sx) < EXPORT_STALE_PX &&
      Math.abs(a.sy - sy) < EXPORT_STALE_PX &&
      Math.abs(a.tx - tx) < EXPORT_STALE_PX &&
      Math.abs(a.ty - ty) < EXPORT_STALE_PX);
  if (!fresh) return { exit, entry };

  if (input.waypoints?.length) {
    return { exit, entry, waypoints: input.waypoints.map((p) => ({ ...p })) };
  }
  if (input.centerY !== undefined) {
    // The smoothstep shape is an orthogonal two-bend path; naming its corners
    // is what lets the diagram reproduce it.
    return {
      exit,
      entry,
      waypoints: [
        { x: sx, y: input.centerY },
        { x: tx, y: input.centerY },
      ],
    };
  }
  return { exit, entry };
}
