/**
 * C4-notation layout engine for the Dependency Report.
 *
 * Converts GNode / GEdge data into React Flow nodes and edges.
 * Nodes are grouped by architectural-layer category using React Flow
 * group nodes. Each category group is laid out independently using dagre,
 * then groups are stacked vertically in C4 layer order so they never overlap.
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { CardType } from "@/types";

/* ------------------------------------------------------------------ */
/*  Input types (same as DependencyReport)                             */
/* ------------------------------------------------------------------ */

export interface GNode {
  id: string;
  name: string;
  type: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  parent_id?: string | null;
  path?: string[];
}

export interface GEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  reverse_label?: string;
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Custom node data                                                   */
/* ------------------------------------------------------------------ */

export interface C4NodeData {
  name: string;
  typeKey: string;
  typeLabel: string;
  typeColor: string;
  category: string;
  nodeId?: string;
  onLongPress?: (id: string) => void;
  dimmed?: boolean;
  [key: string]: unknown;
}

export interface C4GroupData {
  label: string;
  color: string;
  [key: string]: unknown;
}

export interface C4EdgeData {
  relLabel: string;
  description?: string;
  connectedToHovered?: boolean;
  highlightMode?: boolean;
  pathOffset?: number;
  labelNudge?: number;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const C4_NODE_W = 200;
export const C4_NODE_H = 72;

const CATEGORY_ORDER = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

const CATEGORY_COLORS: Record<string, string> = {
  "Strategy & Transformation": "#33cc58",
  "Business Architecture": "#2889ff",
  "Application & Data": "#0f7eb5",
  "Technical Architecture": "#d29270",
};

/** Padding inside each group boundary */
const PAD = 30;
/** Height reserved for the category label at top of group */
const LABEL_H = 32;
/** Vertical gap between stacked category groups */
const GROUP_GAP = 48;
/** Max nodes per row when a category has many nodes with no intra-group edges */
const MAX_COLS = 3;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function typeColor(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.color || "#999";
}

function typeLabel(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.label || key;
}

function typeCategory(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.category || "Other";
}

/* ------------------------------------------------------------------ */
/*  Layout one category group using dagre                              */
/* ------------------------------------------------------------------ */

interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

function layoutGroup(
  catNodes: GNode[],
  intraEdges: GEdge[],
): { positioned: PositionedNode[]; width: number; height: number } {
  if (catNodes.length === 0) return { positioned: [], width: 0, height: 0 };

  const nodeIds = new Set(catNodes.map((n) => n.id));

  // Filter edges to only intra-group ones
  const edges = intraEdges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  if (edges.length > 0) {
    // Use dagre for connected nodes
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      ranksep: 50,
      nodesep: 20,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const n of catNodes) {
      g.setNode(n.id, { width: C4_NODE_W, height: C4_NODE_H });
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
      const x = pos.x - C4_NODE_W / 2;
      const y = pos.y - C4_NODE_H / 2;
      positioned.push({ id: n.id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + C4_NODE_W);
      maxY = Math.max(maxY, y + C4_NODE_H);
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
    };
  }

  // No intra-group edges: grid layout
  const cols = Math.min(catNodes.length, MAX_COLS);
  const hGap = 16;
  const vGap = 14;
  const positioned: PositionedNode[] = catNodes.map((n, i) => ({
    id: n.id,
    x: (i % cols) * (C4_NODE_W + hGap),
    y: Math.floor(i / cols) * (C4_NODE_H + vGap),
  }));

  const rows = Math.ceil(catNodes.length / cols);
  return {
    positioned,
    width: cols * C4_NODE_W + (cols - 1) * hGap,
    height: rows * C4_NODE_H + (rows - 1) * vGap,
  };
}

/* ------------------------------------------------------------------ */
/*  Build React Flow nodes + edges with per-group layout               */
/* ------------------------------------------------------------------ */

export function buildC4Flow(
  gNodes: GNode[],
  gEdges: GEdge[],
  types: CardType[],
): { nodes: Node[]; edges: Edge[] } {
  if (gNodes.length === 0) return { nodes: [], edges: [] };

  // Build node ID set for edge validation
  const nodeIdSet = new Set(gNodes.map((n) => n.id));

  // Map nodeId → category
  const nodeCatMap = new Map<string, string>();
  for (const n of gNodes) {
    nodeCatMap.set(n.id, typeCategory(n.type, types));
  }

  // Group nodes by category
  const groups = new Map<string, GNode[]>();
  for (const n of gNodes) {
    const cat = nodeCatMap.get(n.id)!;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(n);
  }

  // Ordered categories
  const orderedCats = [
    ...CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  // Valid edges (both endpoints exist)
  const validEdges = gEdges.filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target));

  // Pass 1: compute layout for each group independently
  interface GroupLayout {
    cat: string;
    positioned: PositionedNode[];
    groupW: number;
    groupH: number;
  }
  const groupLayouts: GroupLayout[] = [];

  for (const cat of orderedCats) {
    const catNodes = groups.get(cat);
    if (!catNodes || catNodes.length === 0) continue;

    const catNodeIds = new Set(catNodes.map((n) => n.id));
    const intraEdges = validEdges.filter(
      (e) => catNodeIds.has(e.source) && catNodeIds.has(e.target),
    );

    const { positioned, width: innerW, height: innerH } = layoutGroup(catNodes, intraEdges);

    groupLayouts.push({
      cat,
      positioned,
      groupW: innerW + 2 * PAD,
      groupH: innerH + LABEL_H + 2 * PAD,
    });
  }

  if (groupLayouts.length === 0) return { nodes: [], edges: [] };

  // Find max group width for horizontal centering
  const maxGroupW = Math.max(...groupLayouts.map((gl) => gl.groupW));

  // Pass 2: place groups vertically, centered horizontally
  const rfNodes: Node[] = [];
  let yOffset = 0;

  for (const gl of groupLayouts) {
    const catNodes = groups.get(gl.cat)!;
    const groupId = `group:${gl.cat}`;
    const gx = Math.round((maxGroupW - gl.groupW) / 2);
    const gy = yOffset;

    rfNodes.push({
      id: groupId,
      type: "c4Group",
      position: { x: gx, y: gy },
      data: {
        label: gl.cat,
        color: CATEGORY_COLORS[gl.cat] || "#999",
      } satisfies C4GroupData,
      style: { width: gl.groupW, height: gl.groupH },
      selectable: false,
      draggable: false,
    });

    // Child nodes positioned relative to group
    for (const p of gl.positioned) {
      const nd = catNodes.find((n) => n.id === p.id)!;
      const relX = PAD + p.x;
      const relY = LABEL_H + PAD + p.y;

      rfNodes.push({
        id: nd.id,
        type: "c4Node",
        position: { x: relX, y: relY },
        parentId: groupId,
        extent: "parent" as const,
        data: {
          name: nd.name,
          typeKey: nd.type,
          typeLabel: typeLabel(nd.type, types),
          typeColor: typeColor(nd.type, types),
          category: gl.cat,
        } satisfies C4NodeData,
        style: { width: C4_NODE_W, height: C4_NODE_H },
        draggable: false,
      });
    }

    yOffset += gl.groupH + GROUP_GAP;
  }

  // Compute absolute center positions for each node (for edge routing)
  const absPos = new Map<string, { x: number; y: number }>();
  for (const n of rfNodes) {
    if (n.type === "c4Node" && n.parentId) {
      const parent = rfNodes.find((p) => p.id === n.parentId);
      if (parent) {
        absPos.set(n.id, {
          x: parent.position.x + n.position.x + C4_NODE_W / 2,
          y: parent.position.y + n.position.y + C4_NODE_H / 2,
        });
      }
    }
  }

  // Deduplicate edges: merge multiple edges between the same pair into one.
  // Track labels per-direction so we can pick the correct label when the
  // visual arrow is flipped for top-to-bottom layout.
  const edgePairMap = new Map<
    string,
    { fwdLabels: string[]; revLabels: string[]; description?: string }
  >();
  for (const e of validEdges) {
    const isNormalized = e.source < e.target;
    const [lo, hi] = isNormalized ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}`;
    // Forward label = label when arrow goes lo→hi; reverse = when hi→lo
    const fwdLbl = isNormalized
      ? (e.label || e.type)
      : (e.reverse_label || e.label || e.type);
    const revLbl = isNormalized
      ? (e.reverse_label || e.label || e.type)
      : (e.label || e.type);

    const existing = edgePairMap.get(key);
    if (existing) {
      if (!existing.fwdLabels.includes(fwdLbl)) existing.fwdLabels.push(fwdLbl);
      if (!existing.revLabels.includes(revLbl)) existing.revLabels.push(revLbl);
    } else {
      edgePairMap.set(key, {
        fwdLabels: [fwdLbl],
        revLabels: [revLbl],
        description: e.description,
      });
    }
  }

  const seen = new Set<string>();
  const dedupedEdges: typeof validEdges = [];
  for (const e of validEdges) {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEdges.push(e);
  }

  // Orient edges top-to-bottom, choosing the correct directional label
  interface OrientedEdge {
    source: string;
    target: string;
    relLabel: string;
    description?: string;
  }
  const oriented: OrientedEdge[] = dedupedEdges.map((e) => {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const merged = edgePairMap.get(`${lo}||${hi}`)!;
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    let source = e.source;
    let target = e.target;
    if (sP && tP && tP.y < sP.y) {
      source = e.target;
      target = e.source;
    }
    // Pick labels matching the final arrow direction (source→target)
    const finalIsNormalized = source < target;
    const labels = finalIsNormalized ? merged.fwdLabels : merged.revLabels;
    return {
      source,
      target,
      relLabel: labels.join(" / "),
      description: merged.description,
    };
  });

  // Handle pair candidates and their Manhattan distance from source→target
  // 5 handles per edge (12%, 30%, 50%, 70%, 88%) for better spread.
  // Rules: side handles always pair same-side (left→left, right→right)
  type HandlePair = { src: string; tgt: string };
  const HANDLE_PAIRS: HandlePair[] = [
    // Bottom → Top (direct: same column)
    { src: "b-1", tgt: "t-1" },
    { src: "b-2", tgt: "t-2" },
    { src: "b-3", tgt: "t-3" },
    { src: "b-4", tgt: "t-4" },
    { src: "b-5", tgt: "t-5" },
    // Bottom → Top (adjacent diagonal, |i-j| = 1)
    { src: "b-1", tgt: "t-2" },
    { src: "b-2", tgt: "t-1" },
    { src: "b-2", tgt: "t-3" },
    { src: "b-3", tgt: "t-2" },
    { src: "b-3", tgt: "t-4" },
    { src: "b-4", tgt: "t-3" },
    { src: "b-4", tgt: "t-5" },
    { src: "b-5", tgt: "t-4" },
    // Bottom → Top (wide diagonal, |i-j| = 2)
    { src: "b-1", tgt: "t-3" },
    { src: "b-3", tgt: "t-1" },
    { src: "b-2", tgt: "t-4" },
    { src: "b-4", tgt: "t-2" },
    { src: "b-3", tgt: "t-5" },
    { src: "b-5", tgt: "t-3" },
    // Bottom → Left side (for sources far to the left of target)
    { src: "b-1", tgt: "left" },
    { src: "b-2", tgt: "left" },
    { src: "b-3", tgt: "left" },
    // Bottom → Right side (for sources far to the right of target)
    { src: "b-3", tgt: "right-tgt" },
    { src: "b-4", tgt: "right-tgt" },
    { src: "b-5", tgt: "right-tgt" },
    // Side → Side (same side only)
    { src: "left-src", tgt: "left" },
    { src: "right", tgt: "right-tgt" },
  ];

  // Handle position offsets relative to node center
  // 5 positions: 12%, 30%, 50%, 70%, 88% of node width
  function handleOffset(h: string): { dx: number; dy: number } {
    switch (h) {
      case "b-1":  return { dx: -C4_NODE_W * 0.38, dy: C4_NODE_H / 2 };
      case "b-2":  return { dx: -C4_NODE_W * 0.20, dy: C4_NODE_H / 2 };
      case "b-3":  return { dx: 0, dy: C4_NODE_H / 2 };
      case "b-4":  return { dx: C4_NODE_W * 0.20, dy: C4_NODE_H / 2 };
      case "b-5":  return { dx: C4_NODE_W * 0.38, dy: C4_NODE_H / 2 };
      case "t-1":  return { dx: -C4_NODE_W * 0.38, dy: -C4_NODE_H / 2 };
      case "t-2":  return { dx: -C4_NODE_W * 0.20, dy: -C4_NODE_H / 2 };
      case "t-3":  return { dx: 0, dy: -C4_NODE_H / 2 };
      case "t-4":  return { dx: C4_NODE_W * 0.20, dy: -C4_NODE_H / 2 };
      case "t-5":  return { dx: C4_NODE_W * 0.38, dy: -C4_NODE_H / 2 };
      case "left-src":
      case "left": return { dx: -C4_NODE_W / 2, dy: 0 };
      case "right":
      case "right-tgt": return { dx: C4_NODE_W / 2, dy: 0 };
      default:     return { dx: 0, dy: 0 };
    }
  }

  // Track used handles per node to avoid reusing same handle
  const usedSrcHandles = new Map<string, Set<string>>();
  const usedTgtHandles = new Map<string, Set<string>>();

  // ---- Compute per-edge path offsets to separate overlapping routes ----
  const BASE_OFFSET = 20;
  const OFFSET_STEP = 24; // ~label height, prevents label overlap

  // Group edge indices by target node
  const edgesByTarget = new Map<string, number[]>();
  for (let i = 0; i < oriented.length; i++) {
    const t = oriented[i].target;
    if (!edgesByTarget.has(t)) edgesByTarget.set(t, []);
    edgesByTarget.get(t)!.push(i);
  }

  const pathOffsets = new Array<number>(oriented.length).fill(BASE_OFFSET);

  for (const indices of edgesByTarget.values()) {
    if (indices.length <= 1) continue;
    // Sort by source X for consistent left-to-right offset assignment
    indices.sort((a, b) => {
      const aX = absPos.get(oriented[a].source)?.x ?? 0;
      const bX = absPos.get(oriented[b].source)?.x ?? 0;
      return aX - bX;
    });
    for (let r = 0; r < indices.length; r++) {
      pathOffsets[indices[r]] = BASE_OFFSET + r * OFFSET_STEP;
    }
  }

  // Also group by source and take max offset from both groupings
  const edgesBySource = new Map<string, number[]>();
  for (let i = 0; i < oriented.length; i++) {
    const s = oriented[i].source;
    if (!edgesBySource.has(s)) edgesBySource.set(s, []);
    edgesBySource.get(s)!.push(i);
  }

  for (const indices of edgesBySource.values()) {
    if (indices.length <= 1) continue;
    indices.sort((a, b) => {
      const aX = absPos.get(oriented[a].target)?.x ?? 0;
      const bX = absPos.get(oriented[b].target)?.x ?? 0;
      return aX - bX;
    });
    for (let r = 0; r < indices.length; r++) {
      pathOffsets[indices[r]] = Math.max(
        pathOffsets[indices[r]],
        BASE_OFFSET + r * OFFSET_STEP,
      );
    }
  }

  // First pass: pick handles for each edge
  const edgeHandles: { src: string; tgt: string }[] = oriented.map((e) => {
    const sPos = absPos.get(e.source);
    const tPos = absPos.get(e.target);

    let bestSrc = "b-3";
    let bestTgt = "t-3";

    if (sPos && tPos) {
      let bestDist = Infinity;
      const usedS = usedSrcHandles.get(e.source) ?? new Set();
      const usedT = usedTgtHandles.get(e.target) ?? new Set();

      for (const pair of HANDLE_PAIRS) {
        const penalty = (usedS.has(pair.src) ? 200 : 0) + (usedT.has(pair.tgt) ? 200 : 0);

        const sOff = handleOffset(pair.src);
        const tOff = handleOffset(pair.tgt);
        const sx = sPos.x + sOff.dx;
        const sy = sPos.y + sOff.dy;
        const tx = tPos.x + tOff.dx;
        const ty = tPos.y + tOff.dy;
        const dist = Math.abs(tx - sx) + Math.abs(ty - sy) + penalty;

        if (dist < bestDist) {
          bestDist = dist;
          bestSrc = pair.src;
          bestTgt = pair.tgt;
        }
      }

      if (!usedSrcHandles.has(e.source)) usedSrcHandles.set(e.source, new Set());
      usedSrcHandles.get(e.source)!.add(bestSrc);
      if (!usedTgtHandles.has(e.target)) usedTgtHandles.set(e.target, new Set());
      usedTgtHandles.get(e.target)!.add(bestTgt);
    }

    return { src: bestSrc, tgt: bestTgt };
  });

  // Approximate label midpoints for collision detection
  // getSmoothStepPath places the label at the path midpoint ≈ average of endpoints
  const LABEL_COLLISION_H = 22; // vertical space a label occupies
  const labelPositions: { lx: number; ly: number }[] = oriented.map((e, i) => {
    const sPos = absPos.get(e.source);
    const tPos = absPos.get(e.target);
    if (!sPos || !tPos) return { lx: 0, ly: 0 };
    const sOff = handleOffset(edgeHandles[i].src);
    const tOff = handleOffset(edgeHandles[i].tgt);
    return {
      lx: (sPos.x + sOff.dx + tPos.x + tOff.dx) / 2,
      ly: (sPos.y + sOff.dy + tPos.y + tOff.dy) / 2,
    };
  });

  // Detect label collisions and compute vertical nudges
  const labelNudges = new Array<number>(oriented.length).fill(0);
  // Group labels that overlap: within 80px horizontally and LABEL_COLLISION_H vertically
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
      // Sort cluster by approximate ly so nudges are consistent
      cluster.sort((a, b) => labelPositions[a].ly - labelPositions[b].ly);
      const mid = (cluster.length - 1) / 2;
      for (let k = 0; k < cluster.length; k++) {
        labelNudges[cluster[k]] = (k - mid) * LABEL_COLLISION_H;
        assigned.add(cluster[k]);
      }
    }
  }

  const rfEdges: Edge[] = oriented.map((e, i) => ({
    id: `c4e-${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: edgeHandles[i].src,
    targetHandle: edgeHandles[i].tgt,
    type: "c4Edge",
    label: e.relLabel,
    data: {
      relLabel: e.relLabel,
      description: e.description,
      pathOffset: pathOffsets[i],
      labelNudge: labelNudges[i],
    } satisfies C4EdgeData,
    animated: false,
    markerEnd: { type: "arrowclosed" as const, color: "#888" },
  }));

  return { nodes: rfNodes, edges: rfEdges };
}
