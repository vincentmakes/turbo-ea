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

  // Deduplicate edges: merge multiple edges between the same pair into one
  const edgePairMap = new Map<string, { labels: string[]; description?: string }>();
  for (const e of validEdges) {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}`;
    const existing = edgePairMap.get(key);
    const lbl = e.label || e.type;
    if (existing) {
      if (!existing.labels.includes(lbl)) existing.labels.push(lbl);
    } else {
      edgePairMap.set(key, { labels: [lbl], description: e.description });
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

  // Orient edges top-to-bottom
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
    return { source, target, relLabel: merged.labels.join(" / "), description: merged.description };
  });

  // Handle pair candidates and their Manhattan distance from source→target
  // Rules: side handles always pair same-side (left→left, right→right)
  type HandlePair = { src: string; tgt: string };
  const HANDLE_PAIRS: HandlePair[] = [
    // Bottom → Top (vertical, spread)
    { src: "b-l", tgt: "t-l" },
    { src: "b-c", tgt: "t-c" },
    { src: "b-r", tgt: "t-r" },
    // Bottom → Top (diagonal spread)
    { src: "b-l", tgt: "t-c" },
    { src: "b-r", tgt: "t-c" },
    { src: "b-c", tgt: "t-l" },
    { src: "b-c", tgt: "t-r" },
    { src: "b-l", tgt: "t-r" },
    { src: "b-r", tgt: "t-l" },
    // Side → Side (same side only)
    { src: "left-src", tgt: "left" },
    { src: "right", tgt: "right-tgt" },
  ];

  // Handle position offsets relative to node center
  function handleOffset(h: string): { dx: number; dy: number } {
    switch (h) {
      case "b-l":  return { dx: -C4_NODE_W * 0.25, dy: C4_NODE_H / 2 };
      case "b-c":  return { dx: 0, dy: C4_NODE_H / 2 };
      case "b-r":  return { dx: C4_NODE_W * 0.25, dy: C4_NODE_H / 2 };
      case "t-l":  return { dx: -C4_NODE_W * 0.25, dy: -C4_NODE_H / 2 };
      case "t-c":  return { dx: 0, dy: -C4_NODE_H / 2 };
      case "t-r":  return { dx: C4_NODE_W * 0.25, dy: -C4_NODE_H / 2 };
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

  const rfEdges: Edge[] = oriented.map((e, i) => {
    const sPos = absPos.get(e.source);
    const tPos = absPos.get(e.target);

    let bestSrc = "b-c";
    let bestTgt = "t-c";

    if (sPos && tPos) {
      let bestDist = Infinity;
      const usedS = usedSrcHandles.get(e.source) ?? new Set();
      const usedT = usedTgtHandles.get(e.target) ?? new Set();

      for (const pair of HANDLE_PAIRS) {
        // Prefer unused handles (add penalty for reuse)
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

      // Mark handles as used
      if (!usedSrcHandles.has(e.source)) usedSrcHandles.set(e.source, new Set());
      usedSrcHandles.get(e.source)!.add(bestSrc);
      if (!usedTgtHandles.has(e.target)) usedTgtHandles.set(e.target, new Set());
      usedTgtHandles.get(e.target)!.add(bestTgt);
    }

    return {
      id: `c4e-${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: bestSrc,
      targetHandle: bestTgt,
      type: "c4Edge",
      label: e.relLabel,
      data: {
        relLabel: e.relLabel,
        description: e.description,
      } satisfies C4EdgeData,
      animated: false,
      markerEnd: { type: "arrowclosed" as const, color: "#888" },
    };
  });

  return { nodes: rfNodes, edges: rfEdges };
}
