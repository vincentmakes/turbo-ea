/**
 * Layout engine for the Layered Dependency View — Turbo EA's house notation
 * for showing dependencies between cards across the four EA layers
 * (see frontend/UI_GUIDELINES.md § 3.10).
 *
 * Converts GNode / GEdge data into React Flow nodes and edges.
 * Nodes are grouped by architectural-layer category using React Flow
 * group nodes. Each category group is laid out independently using dagre,
 * then groups are stacked vertically in EA layer order so they never overlap.
 */

import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import { getCurrentPhase } from "@/components/LifecycleBadge";
import { LAYER_COLORS } from "@/theme/tokens";
import type { CardType, RelationType, FieldOption } from "@/types";
import type { TimelineChange } from "./timelineRange";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import {
  routeLdvEdges,
  type OrientedEdge,
  type NodeBounds,
  type Bounds,
} from "./ldvEdgeRouting";

export { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";

/* ------------------------------------------------------------------ */
/*  Input types (same as DependencyReport)                             */
/* ------------------------------------------------------------------ */

export interface GNode {
  id: string;
  name: string;
  type: string;
  /** Metamodel subtype key, when the card has one. */
  subtype?: string;
  lifecycle?: Record<string, string>;
  attributes?: Record<string, unknown>;
  parent_id?: string | null;
  path?: string[];
  proposed?: boolean;
  /** How this card's presence changes between today and the time-travelled date
   *  the consumer is showing (set by the consumer — the view has no timeline of
   *  its own). Drives the "arriving"/"retiring" badge. */
  changeState?: TimelineChange;
  /** Set by the consumer: a neighbour comes or goes at the mark being stood on
   *  while this card stays put (linked to a card retired by then). */
  gainedLink?: boolean;
  lostLink?: boolean;
  /** Whether this card has any child card in the full dataset (set by the
   *  consumer, which holds the whole graph). Drives the "has hidden children"
   *  hierarchy marker — the view only sees the visible slice, so it can't
   *  derive this on its own. */
  hasChildren?: boolean;
}

export interface GEdge {
  source: string;
  target: string;
  type: string;
  label?: string;
  reverse_label?: string;
  description?: string;
  attributes?: Record<string, unknown>;
}

/**
 * Resolve which card ids the "Reveal parent" / "Reveal children" toolbar tools
 * surface when `clickedId` is clicked. Hierarchy-based (uses `parent_id`):
 *  - "parents": the clicked card's single hierarchical parent (if present in the graph).
 *  - "children": every card whose `parent_id` is the clicked card.
 * Returns ids only — the consumer adds them to its visible BFS set. Pure so it
 * can be shared by every LDV consumer and unit-tested.
 */
export function resolveRevealIds(
  nodes: GNode[],
  nodeMap: Map<string, GNode>,
  clickedId: string,
  kind: "parents" | "children",
): string[] {
  if (kind === "parents") {
    const parentId = nodeMap.get(clickedId)?.parent_id;
    return parentId && nodeMap.has(parentId) ? [parentId] : [];
  }
  return nodes.filter((n) => n.parent_id === clickedId).map((n) => n.id);
}

/**
 * Drop nodes whose lifecycle phase is `endOfLife`, then drop any edge that lost
 * an endpoint. Three kinds of node are always kept, because each is something
 * the consumer put on the diagram on purpose and a generic filter has no
 * business second-guessing: the centered card (`centerId`), a proposed/NEW card,
 * and a card the consumer marked `changeState: "retired"` — which is
 * end-of-life at the viewed date *by definition*, and is precisely what a
 * time-travelled view is trying to show.
 *
 * `asOfMs` evaluates the phase at a time-travelled date instead of today. It is
 * not optional for a consumer that time-travels: judging "end of life" against
 * today would delete a card from a past-dated view that was very much alive then.
 */
export function filterEndOfLifeNodes(
  nodes: GNode[],
  edges: GEdge[],
  centerId?: string,
  asOfMs?: number,
): { nodes: GNode[]; edges: GEdge[] } {
  const visible = nodes.filter(
    (n) =>
      n.id === centerId ||
      n.proposed ||
      n.changeState === "retired" ||
      getCurrentPhase(n.lifecycle, asOfMs) !== "endOfLife",
  );
  const ids = new Set(visible.map((n) => n.id));
  return {
    nodes: visible,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

/* ------------------------------------------------------------------ */
/*  Custom node data                                                   */
/* ------------------------------------------------------------------ */

export interface LdvNodeData {
  name: string;
  typeKey: string;
  typeLabel: string;
  /** Raw subtype key; the view resolves it to a label for display. */
  subtypeKey?: string;
  typeColor: string;
  typeIcon: string;
  category: string;
  nodeId?: string;
  onClick?: (id: string, shiftKey: boolean) => void;
  onLongPress?: (id: string) => void;
  dimmed?: boolean;
  usedHandles?: string[];
  proposed?: boolean;
  changeState?: TimelineChange;
  gainedLink?: boolean;
  lostLink?: boolean;
  /** The card the graph is built around — injected by the view, not the layout. */
  isCenter?: boolean;
  /** A card the reader expanded, pulling its relations onto the canvas. */
  isExpanded?: boolean;
  [key: string]: unknown;
}

export interface LdvGroupData {
  label: string;
  color: string;
  [key: string]: unknown;
}

export interface LdvEdgeData {
  relLabel: string;
  /**
   * Relation flow direction, surfaced separately from `relLabel` so the edge
   * component can render it as a vector SVG arrow (→ / ↔ / ←) rather than a
   * Unicode glyph baked into the text — the glyph relies on a system-font
   * fallback that html-to-image can't embed, so it disappears in PNG/SVG
   * exports. Vector shapes rasterise identically live and in export.
   */
  flowDirection?: "forward" | "reverse" | "bidirectional";
  /** One endpoint is retired at the viewed date: this dependency is being
   *  severed by the transformation. Rendered in the error colour. */
  severed?: boolean;
  description?: string;
  connectedToHovered?: boolean;
  isHovered?: boolean;
  highlightMode?: boolean;
  pathOffset?: number;
  minOffset?: number; // minimum offset to clear obstructing nodes
  labelT?: number;
  /** Explicit y for the horizontal run (staggered + kept clear of cards).
   *  Unset on side-handle and obstructed edges — those keep the default
   *  smoothstep shape. */
  centerY?: number;
  onHover?: () => void;
  onLeave?: () => void;
  [key: string]: unknown;
}

/**
 * Clear the verb from every edge, for the "hide relationship labels" display
 * option.
 *
 * Applied AFTER layout on purpose: the layout detects colliding labels and
 * spreads them along their own paths, so building without labels would move
 * the edges — and edges must not shift when the verbs are merely hidden.
 *
 * The label the edge component renders is `data.relLabel`, NOT React Flow's
 * own `label` prop. Clearing the latter type-checks (RF's Edge declares it)
 * and does exactly nothing, which is how the option shipped inert once —
 * keeping the field name in one tested place is the point of this helper.
 */
export function stripEdgeLabels(edges: Edge[]): Edge[] {
  return edges.map((e) => {
    const d = e.data as LdvEdgeData | undefined;
    return d?.relLabel ? { ...e, data: { ...d, relLabel: "" } } : e;
  });
}


/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_ORDER = [
  "Strategy & Transformation",
  "Business Architecture",
  "Application & Data",
  "Technical Architecture",
];

const CATEGORY_COLORS: Record<string, string> = LAYER_COLORS;

/** Padding inside each group boundary */
const PAD = 30;
/** Extra empty space inside each layer box so cards can be dragged/rearranged
 *  within their layer (they are clamped to the box via extent: "parent"). */
const DRAG_ROOM = 56;
/** Height reserved for the category label at top of group */
const LABEL_H = 32;
/** Vertical gap between stacked category groups */
const GROUP_GAP = 72;
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

function typeIcon(key: string, types: CardType[]): string {
  return types.find((t) => t.key === key)?.icon || "category";
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
      g.setNode(n.id, { width: LDV_NODE_W, height: LDV_NODE_H });
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
      const x = pos.x - LDV_NODE_W / 2;
      const y = pos.y - LDV_NODE_H / 2;
      positioned.push({ id: n.id, x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + LDV_NODE_W);
      maxY = Math.max(maxY, y + LDV_NODE_H);
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

  // No intra-group edges: grid layout
  const cols = Math.min(catNodes.length, MAX_COLS);
  const hGap = 40;
  const vGap = 30;
  const positioned: PositionedNode[] = catNodes.map((n, i) => ({
    id: n.id,
    x: (i % cols) * (LDV_NODE_W + hGap),
    y: Math.floor(i / cols) * (LDV_NODE_H + vGap),
  }));

  const rows = Math.ceil(catNodes.length / cols);
  return {
    positioned,
    width: cols * LDV_NODE_W + (cols - 1) * hGap,
    height: rows * LDV_NODE_H + (rows - 1) * vGap,
    hGap,
  };
}

/* ------------------------------------------------------------------ */
/*  Cross-lane horizontal alignment                                    */
/* ------------------------------------------------------------------ */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
): AlignedLane[] {
  const laneIdxOf = new Map<string, number>();
  lanes.forEach((lane, li) => {
    for (const p of lane.positioned) laneIdxOf.set(p.id, li);
  });

  // Initial global center x: replicate the historical centred placement so a
  // node with no neighbours keeps exactly the position it had before.
  const innerWs = lanes.map((lane) =>
    lane.positioned.length ? Math.max(...lane.positioned.map((p) => p.x)) + LDV_NODE_W : 0,
  );
  const groupWs = innerWs.map((w) => w + 2 * PAD + DRAG_ROOM);
  const maxGroupW = Math.max(...groupWs, 0);
  const centerX = new Map<string, number>();
  lanes.forEach((lane, li) => {
    const gx = Math.round((maxGroupW - groupWs[li]) / 2);
    for (const p of lane.positioned) centerX.set(p.id, gx + p.x + LDV_NODE_W / 2);
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

  // Rows per lane, bucketed by (rounded) y — row membership is frozen.
  const rowsPerLane = lanes.map((lane) => {
    const byY = new Map<number, string[]>();
    for (const p of lane.positioned) {
      const y = Math.round(p.y);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push(p.id);
    }
    return [...byY.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids);
  });

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

      // Resolve each row: order by desired x, enforce minimum separation
      // left→right, then relax right→left back toward the desired positions.
      const minSep = LDV_NODE_W + lanes[li].hGap;
      for (const row of rowsPerLane[li]) {
        const entries = row
          .map((id) => ({ id, d: desired.get(id)! }))
          .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const xs = new Array<number>(entries.length);
        for (let i = 0; i < entries.length; i++) {
          xs[i] = i === 0 ? entries[i].d : Math.max(entries[i].d, xs[i - 1] + minSep);
        }
        for (let i = entries.length - 1; i >= 0; i--) {
          const upper = i === entries.length - 1 ? Infinity : xs[i + 1] - minSep;
          const lower = i === 0 ? -Infinity : xs[i - 1] + minSep;
          xs[i] = Math.min(Math.max(entries[i].d, lower), upper);
        }
        for (let i = 0; i < entries.length; i++) centerX.set(entries[i].id, xs[i]);
      }
    }
  }

  // Re-express as lane-local positions + a global lane offset, with the
  // leftmost lane box normalised to x = 0.
  const laneLefts = lanes.map((lane) =>
    lane.positioned.length
      ? Math.min(...lane.positioned.map((p) => centerX.get(p.id)! - LDV_NODE_W / 2))
      : 0,
  );
  const minBoxX = Math.min(...laneLefts.map((left) => left - PAD));
  return lanes.map((lane, li) => {
    const left = laneLefts[li];
    const positioned = lane.positioned.map((p) => ({
      id: p.id,
      x: centerX.get(p.id)! - LDV_NODE_W / 2 - left,
      y: p.y,
    }));
    const innerW = lane.positioned.length
      ? Math.max(...positioned.map((p) => p.x)) + LDV_NODE_W
      : 0;
    return { positioned, innerW, offsetX: left - PAD - minBoxX };
  });
}

/* ------------------------------------------------------------------ */
/*  Build React Flow nodes + edges with per-group layout               */
/* ------------------------------------------------------------------ */

/**
 * Build the bracketed suffix for a relation's single-select attribute value(s),
 * e.g. `" [Leading]"` or `" [Owner · Leading]"`. Returns undefined when the
 * relation has no displayable value. `flowDirection` is intentionally excluded —
 * it is shown as a direction arrow, not a bracketed value.
 *
 * `resolveOptionLabel` localises an option to its display text (the caller binds
 * it to the current locale). Pure (no React) so it is unit-testable.
 */
export function relationValueSuffix(
  edge: GEdge,
  relTypeByKey: Map<string, RelationType>,
  resolveOptionLabel: (opt: FieldOption) => string,
): string | undefined {
  const rt = relTypeByKey.get(edge.type);
  const attrs = edge.attributes;
  if (!rt || !attrs) return undefined;
  const parts: string[] = [];
  for (const field of rt.attributes_schema || []) {
    if (field.type !== "single_select" || field.key === "flowDirection") continue;
    const raw = attrs[field.key];
    if (raw == null || raw === "") continue;
    const opt = field.options?.find((o) => o.key === raw);
    if (!opt) continue;
    parts.push(resolveOptionLabel(opt));
  }
  return parts.length > 0 ? ` [${parts.join(" · ")}]` : undefined;
}

export function buildLdvFlow(
  gNodes: GNode[],
  gEdges: GEdge[],
  types: CardType[],
  /**
   * Optional resolver that returns a bracketed suffix for a relation's
   * single-select attribute value(s), e.g. `" [Leading]"`. Returns undefined
   * when the relation has no displayable value. When omitted, labels render
   * exactly as before (label-only).
   */
  relValueResolver?: (edge: GEdge) => string | undefined,
): { nodes: Node[]; edges: Edge[] } {
  if (gNodes.length === 0) return { nodes: [], edges: [] };

  // For severing edges whose endpoint is retired at the viewed date.
  const changeStateById = new Map(gNodes.map((n) => [n.id, n.changeState]));

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
    hGap: number;
  }
  const groupLayouts: GroupLayout[] = [];

  for (const cat of orderedCats) {
    const catNodes = groups.get(cat);
    if (!catNodes || catNodes.length === 0) continue;

    const catNodeIds = new Set(catNodes.map((n) => n.id));
    const intraEdges = validEdges.filter(
      (e) => catNodeIds.has(e.source) && catNodeIds.has(e.target),
    );

    const { positioned, width: innerW, height: innerH, hGap } = layoutGroup(catNodes, intraEdges);

    groupLayouts.push({
      cat,
      positioned,
      groupW: innerW + 2 * PAD + DRAG_ROOM,
      groupH: innerH + LABEL_H + 2 * PAD + DRAG_ROOM,
      hGap,
    });
  }

  if (groupLayouts.length === 0) return { nodes: [], edges: [] };

  // Cross-lane x-alignment: per-lane layouts are blind to edges that span
  // lanes, so connected cards land horizontally far apart and their edges run
  // as long diagonals. When cross-lane edges exist, nudge x positions so
  // linked cards line up vertically; otherwise keep the historical centred
  // placement (identical output for edge-free graphs).
  const crossEdges = validEdges.filter(
    (e) => nodeCatMap.get(e.source) !== nodeCatMap.get(e.target),
  );
  let laneGx: number[];
  if (crossEdges.length > 0) {
    const intraEdgesAll = validEdges.filter(
      (e) => nodeCatMap.get(e.source) === nodeCatMap.get(e.target),
    );
    const aligned = alignLanesX(
      groupLayouts.map((gl) => ({ positioned: gl.positioned, hGap: gl.hGap })),
      crossEdges,
      intraEdgesAll,
    );
    laneGx = aligned.map((a) => a.offsetX);
    groupLayouts.forEach((gl, i) => {
      gl.positioned = aligned[i].positioned;
      gl.groupW = aligned[i].innerW + 2 * PAD + DRAG_ROOM;
    });
  } else {
    const maxGroupW = Math.max(...groupLayouts.map((gl) => gl.groupW));
    laneGx = groupLayouts.map((gl) => Math.round((maxGroupW - gl.groupW) / 2));
  }

  // Pass 2: place groups vertically at their aligned (or centred) x
  const rfNodes: Node[] = [];
  let yOffset = 0;

  for (let gi = 0; gi < groupLayouts.length; gi++) {
    const gl = groupLayouts[gi];
    const catNodes = groups.get(gl.cat)!;
    const groupId = `group:${gl.cat}`;
    const gx = laneGx[gi];
    const gy = yOffset;

    rfNodes.push({
      id: groupId,
      type: "ldvGroup",
      position: { x: gx, y: gy },
      data: {
        label: gl.cat,
        color: CATEGORY_COLORS[gl.cat] || "#999",
      } satisfies LdvGroupData,
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
        type: "ldvNode",
        position: { x: relX, y: relY },
        parentId: groupId,
        extent: "parent" as const,
        data: {
          name: nd.name,
          typeKey: nd.type,
          typeLabel: typeLabel(nd.type, types),
          subtypeKey: nd.subtype,
          typeColor: typeColor(nd.type, types),
          typeIcon: typeIcon(nd.type, types),
          category: gl.cat,
          proposed: nd.proposed,
          changeState: nd.changeState,
          gainedLink: nd.gainedLink,
          lostLink: nd.lostLink,
        } satisfies LdvNodeData,
        style: { width: LDV_NODE_W, height: LDV_NODE_H },
        draggable: false,
      });
    }

    yOffset += gl.groupH + GROUP_GAP;
  }

  // Lookup map for node-by-id, reused by the position + grouping passes below
  // (was a linear `.find()` inside each loop — O(N²)).
  const nodeById = new Map(rfNodes.map((n) => [n.id, n]));

  // Compute absolute center positions for each node (for edge routing)
  const absPos = new Map<string, { x: number; y: number }>();
  for (const n of rfNodes) {
    if (n.type === "ldvNode" && n.parentId) {
      const parent = nodeById.get(n.parentId);
      if (parent) {
        absPos.set(n.id, {
          x: parent.position.x + n.position.x + LDV_NODE_W / 2,
          y: parent.position.y + n.position.y + LDV_NODE_H / 2,
        });
      }
    }
  }

  // Deduplicate edges: merge multiple edges between the same pair into one.
  // Track labels per-direction so we can pick the correct label when the
  // visual arrow is flipped for top-to-bottom layout.
  type FlowDir = "bidirectional" | "forward" | "reverse";
  const edgePairMap = new Map<
    string,
    {
      fwdLabels: string[];
      revLabels: string[];
      description?: string;
      // flowDirection captured per pair, in pair-normalised orientation
      // (i.e. relative to lo→hi, not the relation's metamodel direction).
      flowDirection?: FlowDir;
    }
  >();
  const readFlowDir = (attrs: Record<string, unknown> | undefined): FlowDir | undefined => {
    const v = attrs?.flowDirection;
    return v === "bidirectional" || v === "forward" || v === "reverse" ? v : undefined;
  };
  for (const e of validEdges) {
    const isNormalized = e.source < e.target;
    const [lo, hi] = isNormalized ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}`;
    // Append the relation's single-select attribute value (e.g. " [Leading]")
    // so it flows through the per-pair merge / " / " join / dedup unchanged.
    const valueSuffix = relValueResolver?.(e) ?? "";
    // Forward label = label when arrow goes lo→hi; reverse = when hi→lo
    const fwdLbl =
      (isNormalized ? (e.label || e.type) : (e.reverse_label || e.label || e.type)) + valueSuffix;
    const revLbl =
      (isNormalized ? (e.reverse_label || e.label || e.type) : (e.label || e.type)) + valueSuffix;

    // Re-orient flowDirection to the pair-normalised lo→hi axis so different
    // relation types between the same pair don't fight each other.
    let fd = readFlowDir(e.attributes);
    if (fd && !isNormalized) {
      if (fd === "forward") fd = "reverse";
      else if (fd === "reverse") fd = "forward";
    }

    const existing = edgePairMap.get(key);
    if (existing) {
      if (!existing.fwdLabels.includes(fwdLbl)) existing.fwdLabels.push(fwdLbl);
      if (!existing.revLabels.includes(revLbl)) existing.revLabels.push(revLbl);
      // If existing pair has no direction yet, adopt this one. If they
      // disagree (e.g. one forward + one reverse), upgrade to bidirectional.
      if (fd && existing.flowDirection !== fd) {
        existing.flowDirection = existing.flowDirection ? "bidirectional" : fd;
      }
    } else {
      edgePairMap.set(key, {
        fwdLabels: [fwdLbl],
        revLabels: [revLbl],
        description: e.description,
        flowDirection: fd,
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

  // Keep metamodel source→target direction on edges.  The arrow (markerEnd)
  // must always point from the relation's semantic source to its target so that
  // it matches the metamodel definition.  We only choose the label that matches
  // the original (un-flipped) direction and track a `flipped` flag so handle
  // routing can use top→bottom or bottom→top handles as needed for the layout.
  const oriented: OrientedEdge[] = dedupedEdges.map((e) => {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const merged = edgePairMap.get(`${lo}||${hi}`)!;
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    // Source→target preserved; flipped when target is above source visually
    const flipped = !!(sP && tP && tP.y < sP.y);
    // Labels always match the original metamodel direction (source→target)
    const isNormalized = e.source < e.target;
    const labels = isNormalized ? merged.fwdLabels : merged.revLabels;
    // Re-orient the pair-normalised flowDirection back onto the metamodel
    // source→target axis. When this edge is the "reverse" of the
    // normalisation pair, swap forward ↔ reverse so the marker logic below
    // reads relative to (e.source, e.target).
    let fd = merged.flowDirection;
    if (fd && !isNormalized) {
      if (fd === "forward") fd = "reverse";
      else if (fd === "reverse") fd = "forward";
    }
    // The direction is carried on `flowDirection` and rendered as a vector SVG
    // arrow next to the label by the edge component, so it survives image
    // export (a Unicode glyph baked into the text does not — see LdvEdgeData).
    const relLabel = labels.join(" / ");
    return {
      source: e.source,
      target: e.target,
      relLabel,
      description: merged.description,
      flipped,
      flowDirection: fd,
    };
  });

  // Collect all node bounding boxes for obstruction + label overlap checks
  const allNodeBounds: NodeBounds[] = [];
  for (const [nid, pos] of absPos) {
    allNodeBounds.push({
      id: nid,
      x1: pos.x - LDV_NODE_W / 2,
      y1: pos.y - LDV_NODE_H / 2,
      x2: pos.x + LDV_NODE_W / 2,
      y2: pos.y + LDV_NODE_H / 2,
    });
  }

  // Also collect group label areas (top strip of each group box) for label overlap
  // These are not used for obstruction routing, only for label placement.
  const groupLabelBounds: Bounds[] = [];
  for (const n of rfNodes) {
    if (n.type === "ldvGroup") {
      const w = (n.style?.width as number) ?? 0;
      groupLabelBounds.push({
        x1: n.position.x,
        y1: n.position.y,
        x2: n.position.x + w,
        y2: n.position.y + LABEL_H + 8, // group label area + margin
      });
    }
  }

  // Map each node to its lane group (for gap bucketing + same-lane checks)
  const nodeGroupCat = new Map<string, string>();
  for (const n of rfNodes) {
    if (n.type === "ldvNode" && n.parentId) {
      const parent = nodeById.get(n.parentId);
      if (parent && parent.type === "ldvGroup") {
        nodeGroupCat.set(n.id, parent.id);
      }
    }
  }

  // Route every edge: ordered port assignment, obstruction clearance, offset
  // staggering, and label placement — see ldvEdgeRouting.ts.
  const { routes, usedHandles: allUsedHandles } = routeLdvEdges(
    oriented,
    absPos,
    allNodeBounds,
    groupLabelBounds,
    nodeGroupCat,
  );

  const rfEdges: Edge[] = oriented.map((e, i) => {
    // Arrowheads encode flow direction:
    //  - forward (default semantics): arrow at target end only
    //  - reverse: arrow at source end only — data flows target → source
    //  - bidirectional: arrows on both ends
    //  - unset: keep the historical default (markerEnd only)
    const severed =
      changeStateById.get(e.source) === "retired" || changeStateById.get(e.target) === "retired";
    const arrow = { type: "arrowclosed" as const, color: severed ? "#d32f2f" : "#888" };
    const markerStart =
      e.flowDirection === "reverse" || e.flowDirection === "bidirectional" ? arrow : undefined;
    const markerEnd =
      e.flowDirection === "reverse" ? undefined : arrow;
    return {
      id: `ldve-${i}`,
      source: e.source,
      target: e.target,
      sourceHandle: routes[i].sourceHandle,
      targetHandle: routes[i].targetHandle,
      type: "ldvEdge",
      label: e.relLabel,
      data: {
        relLabel: e.relLabel,
        flowDirection: e.flowDirection,
        description: e.description,
        severed,
        pathOffset: routes[i].pathOffset,
        minOffset: routes[i].minOffset,
        labelT: routes[i].labelT,
        ...(routes[i].centerY !== undefined ? { centerY: routes[i].centerY } : {}),
      } satisfies LdvEdgeData,
      animated: false,
      ...(markerStart ? { markerStart } : {}),
      ...(markerEnd ? { markerEnd } : {}),
    };
  });

  // Inject used handles into ldvNode data (handle selection happens after node creation)
  for (const n of rfNodes) {
    if (n.type === "ldvNode") {
      const used = allUsedHandles.get(n.id);
      (n.data as LdvNodeData).usedHandles = used ? [...used] : [];
    }
  }

  return { nodes: rfNodes, edges: rfEdges };
}
