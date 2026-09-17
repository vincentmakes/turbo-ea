/**
 * Geometry primitives shared by the Layered Dependency View's two layout
 * builders: `buildLdvFlow` (one card per node) and `buildLdvAggregateFlow`
 * (cards clustered into type / subtype / layer boxes).
 *
 * They live here rather than in `layeredDependencyLayout.ts` because the
 * aggregate builder needs them and that module re-exports the aggregate
 * builder — importing them back the other way would be a runtime import
 * cycle. Nothing here knows about React or React Flow.
 */

import dagre from "@dagrejs/dagre";
import { LAYER_COLORS } from "@/theme/tokens";
import type { CardType } from "@/types";
import type { GNode, GEdge } from "./layeredDependencyLayout";
import { cardSizes, LDV_NODE_W, type SizeLookup } from "./ldvHandles";



/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const CATEGORY_ORDER = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

export const CATEGORY_COLORS: Record<string, string> = LAYER_COLORS;

/** Padding inside each group boundary */
export const PAD = 30;
/** Extra empty space inside each layer box so cards can be dragged/rearranged
 *  within their layer (they are clamped to the box via extent: "parent"). */
export const DRAG_ROOM = 56;
/** Height reserved for the category label at top of group */
export const LABEL_H = 32;
/** Vertical gap between stacked category groups */
export const GROUP_GAP = 72;
/** Max nodes per row when a category has many nodes with no intra-group edges */
export const MAX_COLS = 3;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function typeColor(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.color || "#999";
}

export function typeLabel(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.label || key;
}

export function typeIcon(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.icon || "category";
}

export function typeCategory(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.category || "Other";
}

/* ------------------------------------------------------------------ */
/*  Layout one category group using dagre                              */
/* ------------------------------------------------------------------ */

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

export function layoutGroup(
  catNodes: GNode[],
  intraEdges: GEdge[],
  /**
   * How big each node is. Aggregate mode lays out boxes of cards with this very
   * function, and a box is neither card-sized nor uniform; omitted, every node
   * is a card, exactly as before.
   */
  sizeOf: SizeLookup = cardSizes,
): { positioned: PositionedNode[]; width: number; height: number; hGap: number } {
  if (catNodes.length === 0) return { positioned: [], width: 0, height: 0, hGap: 40 };

  const nodeIds = new Set(catNodes.map((n) => n.id));

  // Filter edges to only intra-group ones
  const edges = intraEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  if (edges.length > 0) {
    // Use dagre for connected nodes
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      ranksep: 90,
      nodesep: 50,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of catNodes) {
      const { w, h } = sizeOf(n.id);
      g.setNode(n.id, { width: w, height: h });
    }
    for (const e of edges) {
      g.setEdge(e.source, e.target);
    }

    dagre.layout(g);

    const positioned: PositionedNode[] = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const n of catNodes) {
      const pos = g.node(n.id);
      if (!pos) continue;
      const { w, h } = sizeOf(n.id);
      const x = pos.x - w / 2;
      const y = pos.y - h / 2;
      positioned.push({ id: n.id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    }

    // Normalize to origin
    for (const p of positioned) {
      p.x -= minX;
      p.y -= minY;
    }

    return {
      positioned,
      width: maxX - minX,
      height: maxY - minY,
      hGap: 50, // dagre nodesep
    };
  }

  // No intra-group edges: grid layout. Column widths and row heights come from
  // what is actually in them, so a grid of differently-sized boxes packs without
  // overlapping — with every node card-sized this is the old fixed grid exactly.
  const cols = Math.min(catNodes.length, MAX_COLS);
  const hGap = 40;
  const vGap = 30;
  const rows = Math.ceil(catNodes.length / cols);
  const colW = new Array<number>(cols).fill(0);
  const rowH = new Array<number>(rows).fill(0);
  catNodes.forEach((n, i) => {
    const { w, h } = sizeOf(n.id);
    const c = i % cols;
    const r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c], w);
    rowH[r] = Math.max(rowH[r], h);
  });
  const colX: number[] = [];
  let runX = 0;
  for (let c = 0; c < cols; c++) {
    colX.push(runX);
    runX += colW[c] + hGap;
  }
  const rowY: number[] = [];
  let runY = 0;
  for (let r = 0; r < rows; r++) {
    rowY.push(runY);
    runY += rowH[r] + vGap;
  }
  const positioned: PositionedNode[] = catNodes.map((n, i) => ({
    id: n.id,
    x: colX[i % cols],
    y: rowY[Math.floor(i / cols)],
  }));

  return {
    positioned,
    width: runX - hGap,
    height: runY - vGap,
    hGap,
  };
}

/* ------------------------------------------------------------------ */
/*  Relation flow direction                                            */
/* ------------------------------------------------------------------ */

export type FlowDir = "bidirectional" | "forward" | "reverse";

/** Read a relation's `flowDirection` attribute, ignoring anything unexpected. */
export function readFlowDir(attrs: Record<string, unknown> | undefined): FlowDir | undefined {
  const v = attrs?.flowDirection;
  return v === "bidirectional" || v === "forward" || v === "reverse" ? v : undefined;
}

/* ------------------------------------------------------------------ */
/*  Cross-lane horizontal alignment                                    */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Place one row's nodes by the Sugiyama priority method (the coordinate
 * refinement DrawIO's hierarchical layout uses): the left-to-right sequence
 * is fixed by desired x, but nodes are POSITIONED in descending degree order,
 * so a well-connected hub claims its exact column and sparsely connected
 * nodes yield around it. Already-placed (higher-priority) nodes act as walls
 * at minSep × sequence distance.
 */
function placeRowByPriority(
  row: string[],
  desired: Map<string, number>,
  centerX: Map<string, number>,
  minSep: number,
  degree: Map<string, number>,
): void {
  const entries = row
    .map((id) => ({ id, d: desired.get(id)! }))
    .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const nRow = entries.length;
  const xs = new Array<number>(nRow).fill(NaN);
  const order = entries
    .map((e, seq) => ({ seq, deg: degree.get(e.id) ?? 0, d: e.d, id: e.id }))
    .sort((a, b) => b.deg - a.deg || a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const o of order) {
    let leftWall = -Infinity;
    let rightWall = Infinity;
    for (let s = o.seq - 1; s >= 0; s--) {
      if (!Number.isNaN(xs[s])) {
        leftWall = xs[s] + minSep * (o.seq - s);
        break;
      }
    }
    for (let s = o.seq + 1; s < nRow; s++) {
      if (!Number.isNaN(xs[s])) {
        rightWall = xs[s] - minSep * (s - o.seq);
        break;
      }
    }
    xs[o.seq] = leftWall > rightWall ? leftWall : Math.min(Math.max(o.d, leftWall), rightWall);
  }
  // The walls already guarantee separation except when they conflicted;
  // one left-to-right sweep restores feasibility deterministically.
  for (let i = 1; i < nRow; i++) {
    if (xs[i] < xs[i - 1] + minSep) xs[i] = xs[i - 1] + minSep;
  }
  for (let i = 0; i < nRow; i++) centerX.set(entries[i].id, xs[i]);
}

/**
 * DrawIO-style transpose refinement: adjacent nodes in a row swap positions
 * whenever exchanging them strictly reduces the number of straight-line
 * crossings among the edges incident to the pair. Median placement provably
 * misses swaps a direct crossing count catches. Above-side and below-side
 * edges are counted independently — edges leaving opposite sides of a row
 * cannot cross each other — and swapping exchanges the two x positions, so
 * the row's position multiset (and its minimum separation) is untouched.
 * Crossings with third nodes' edges depend only on left-right order, which a
 * pairwise swap preserves, so each accepted swap strictly reduces the global
 * crossing count and the pass terminates.
 *
 * Exported for unit tests.
 */
export function transposeRow(
  row: string[],
  centerX: Map<string, number>,
  neighborXs: (id: string) => { above: number[]; below: number[] },
  /**
   * Widths, so a swap is only taken between nodes of the same size.
   *
   * The swap exchanges two x positions outright, which preserves the row's
   * separation only while the two nodes are equally wide — true of every card,
   * and false of the aggregate boxes, where swapping a wide box with a narrow
   * one drops the wide one on top of its neighbour. Omitted, every node is a
   * card and every swap is allowed, exactly as before.
   */
  widthOf: (id: string) => number = () => 0,
): void {
  if (row.length < 2) return;
  const inversions = (leftId: string, rightId: string): number => {
    const l = neighborXs(leftId);
    const r = neighborXs(rightId);
    let c = 0;
    for (const side of ["above", "below"] as const) {
      for (const xa of l[side]) for (const xb of r[side]) if (xa > xb) c++;
    }
    return c;
  };
  const ordered = [...row].sort(
    (a, b) => centerX.get(a)! - centerX.get(b)! || (a < b ? -1 : 1),
  );
  for (let pass = 0; pass < ordered.length; pass++) {
    let improved = false;
    for (let k = 0; k + 1 < ordered.length; k++) {
      const u = ordered[k];
      const v = ordered[k + 1];
      if (widthOf(u) !== widthOf(v)) continue;
      if (inversions(v, u) < inversions(u, v)) {
        const xu = centerX.get(u)!;
        centerX.set(u, centerX.get(v)!);
        centerX.set(v, xu);
        ordered[k] = v;
        ordered[k + 1] = u;
        improved = true;
      }
    }
    if (!improved) break;
  }
}

export interface LaneForAlign {
  /** Lane-local node positions (top-left corners, origin-normalised). */
  positioned: PositionedNode[];
  /** Minimum horizontal gap this lane's layout used (dagre nodesep or grid gap). */
  hGap: number;
}

export interface AlignedLane {
  /** Updated lane-local positions (origin-normalised again). */
  positioned: PositionedNode[];
  /** New content width of the lane. */
  innerW: number;
  /** Global x of the lane's group box (min across lanes normalised to 0). */
  offsetX: number;
}

/**
 * Median/barycenter x-alignment across lanes. The per-lane layouts are blind
 * to cross-lane edges, so two connected cards in adjacent lanes routinely end
 * up horizontally far apart and their edge runs as a long diagonal. This
 * post-pass sweeps the lane stack (down, up, down) nudging every card's x
 * toward the median x of its neighbours — cross-lane neighbours in the lanes
 * already visited by the sweep plus intra-lane neighbours — then resolves
 * overlaps within each row deterministically. Rows and lane heights are
 * frozen: only x moves.
 *
 * Exported for unit tests; buildLdvFlow calls it whenever cross-lane edges
 * exist (and keeps the historical centred placement otherwise).
 */
export function alignLanesX(
  lanes: LaneForAlign[],
  crossEdges: { source: string; target: string }[],
  intraEdges: { source: string; target: string }[],
  /** How wide each node is — a card unless aggregate mode says otherwise. */
  sizeOf: SizeLookup = cardSizes,
): AlignedLane[] {
  const laneIdxOf = new Map<string, number>();
  lanes.forEach((lane, li) => {
    for (const p of lane.positioned) laneIdxOf.set(p.id, li);
  });

  // Initial global center x: replicate the historical centred placement so a
  // node with no neighbours keeps exactly the position it had before.
  const innerWs = lanes.map((lane) =>
    lane.positioned.length
      ? Math.max(...lane.positioned.map((p) => p.x + sizeOf(p.id).w))
      : 0,
  );
  const groupWs = innerWs.map((w) => w + 2 * PAD + DRAG_ROOM);
  const maxGroupW = Math.max(...groupWs, 0);
  const centerX = new Map<string, number>();
  lanes.forEach((lane, li) => {
    const gx = Math.round((maxGroupW - groupWs[li]) / 2);
    for (const p of lane.positioned) centerX.set(p.id, gx + p.x + sizeOf(p.id).w / 2);
  });

  // Adjacency (multi-edges weight the median naturally by appearing twice)
  const crossNb = new Map<string, string[]>();
  const intraNb = new Map<string, string[]>();
  const addNb = (map: Map<string, string[]>, a: string, b: string) => {
    if (!map.has(a)) map.set(a, []);
    map.get(a)!.push(b);
  };
  for (const e of crossEdges) {
    if (!laneIdxOf.has(e.source) || !laneIdxOf.has(e.target)) continue;
    addNb(crossNb, e.source, e.target);
    addNb(crossNb, e.target, e.source);
  }
  for (const e of intraEdges) {
    if (!laneIdxOf.has(e.source) || !laneIdxOf.has(e.target)) continue;
    addNb(intraNb, e.source, e.target);
    addNb(intraNb, e.target, e.source);
  }

  // Rows per lane, bucketed by VERTICAL OVERLAP — row membership is frozen.
  //
  // Not by top-edge y: every card is the same height, so a rank of cards shares
  // one y and bucketing on it was the same thing. Aggregate boxes are not — a
  // rank holding a tall box and a short one centres both, so their top edges
  // differ, they fall into separate buckets, and nothing then keeps them apart
  // horizontally. They land on top of each other. Anything that can collide is
  // one row, which is what the separation pass below is for.
  const rowsPerLane = lanes.map((lane) => {
    const sorted = [...lane.positioned].sort((a, b) => a.y - b.y || (a.id < b.id ? -1 : 1));
    const rows: string[][] = [];
    let current: string[] = [];
    let bottom = -Infinity;
    for (const p of sorted) {
      if (current.length > 0 && p.y >= bottom) {
        rows.push(current);
        current = [];
        bottom = -Infinity;
      }
      current.push(p.id);
      bottom = Math.max(bottom, p.y + sizeOf(p.id).h);
    }
    if (current.length > 0) rows.push(current);
    return rows;
  });

  // Degree (total pull count) drives priority placement; the level index
  // (lane, row) splits each node's neighbours into above/below sets for the
  // transpose crossing counts.
  const degree = new Map<string, number>();
  for (const [id, list] of crossNb) degree.set(id, (degree.get(id) ?? 0) + list.length);
  for (const [id, list] of intraNb) degree.set(id, (degree.get(id) ?? 0) + list.length);

  const levelOf = new Map<string, number>();
  lanes.forEach((lane, li) => {
    for (const p of lane.positioned) levelOf.set(p.id, li * 1e7 + Math.round(p.y));
  });
  const neighborXs = (id: string): { above: number[]; below: number[] } => {
    const above: number[] = [];
    const below: number[] = [];
    const own = levelOf.get(id)!;
    for (const map of [crossNb, intraNb]) {
      for (const o of map.get(id) ?? []) {
        const lv = levelOf.get(o);
        // Same-level neighbours (side-handle edges) are crossing-neutral.
        if (lv === undefined || lv === own) continue;
        (lv < own ? above : below).push(centerX.get(o)!);
      }
    }
    return { above, below };
  };

  const sweeps: ("down" | "up")[] = ["down", "up", "down"];
  for (const dir of sweeps) {
    const order = lanes.map((_, li) => li);
    if (dir === "up") order.reverse();
    for (const li of order) {
      // Desired x per node, from a snapshot so intra-lane order of evaluation
      // cannot influence the result.
      const desired = new Map<string, number>();
      for (const p of lanes[li].positioned) {
        const nb: number[] = [];
        for (const o of crossNb.get(p.id) ?? []) {
          const oi = laneIdxOf.get(o)!;
          // Only lanes the sweep has already visited pull on this one —
          // sweeping both directions covers the rest without oscillation.
          if (dir === "down" ? oi < li : oi > li) nb.push(centerX.get(o)!);
        }
        for (const o of intraNb.get(p.id) ?? []) nb.push(centerX.get(o)!);
        desired.set(p.id, nb.length > 0 ? median(nb) : centerX.get(p.id)!);
      }

      // Resolve each row by the priority method (sequence fixed by desired
      // x, hubs claim their exact column, leaves yield), then run the
      // transpose crossing-reduction pass on it.
      for (const row of rowsPerLane[li]) {
        // Separation has to clear the widest pair in the row, so a row holding
        // an aggregate box is spaced for the box rather than for a card.
        const widest = row.length ? Math.max(...row.map((id) => sizeOf(id).w)) : LDV_NODE_W;
        const minSep = widest + lanes[li].hGap;
        placeRowByPriority(row, desired, centerX, minSep, degree);
        transposeRow(row, centerX, neighborXs, (id) => sizeOf(id).w);
      }
    }
  }

  // Re-express as lane-local positions + a global lane offset, with the
  // leftmost lane box normalised to x = 0.
  const laneLefts = lanes.map((lane) =>
    lane.positioned.length
      ? Math.min(...lane.positioned.map((p) => centerX.get(p.id)! - sizeOf(p.id).w / 2))
      : 0,
  );
  const minBoxX = Math.min(...laneLefts.map((left) => left - PAD));
  return lanes.map((lane, li) => {
    const left = laneLefts[li];
    const positioned = lane.positioned.map((p) => ({
      id: p.id,
      x: centerX.get(p.id)! - sizeOf(p.id).w / 2 - left,
      y: p.y,
    }));
    const innerW = lane.positioned.length
      ? Math.max(...positioned.map((p) => p.x + sizeOf(p.id).w))
      : 0;
    return { positioned, innerW, offsetX: left - PAD - minBoxX };
  });
}
