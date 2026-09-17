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

import type { Node, Edge } from "@xyflow/react";
import { getCurrentPhase } from "@/components/LifecycleBadge";
import type { CardType, RelationType, FieldOption } from "@/types";
import type { TimelineChange } from "./timelineRange";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import {
  alignLanesX,
  CATEGORY_COLORS,
  CATEGORY_ORDER,
  DRAG_ROOM,
  GROUP_GAP,
  LABEL_H,
  PAD,
  layoutGroup,
  type PositionedNode,
  readFlowDir,
  typeCategory,
  typeColor,
  typeIcon,
  typeLabel,
} from "./ldvLayoutShared";
import type { LdvEdgeLineStyle } from "./ldvLineStyle";
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
  /** When this card's logo was last written, or null when it has none. The
   *  backend withholds it for types with logos switched off, so the view needs
   *  no rule of its own. Doubles as the image URL's cache-buster. */
  logo_updated_at?: string | null;
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

/**
 * Drop every card whose type the reader unticked in the Card types menu, then
 * drop any edge that lost an endpoint.
 *
 * The centred card is kept whatever its type: it is the subject of the diagram
 * rather than one of its neighbours, and hiding it would leave the view with
 * nothing to be centred on. Same carve-out `filterEndOfLifeNodes` makes, for
 * the same reason.
 *
 * With nothing hidden this returns the very arrays it was given — the view
 * feeds the result straight into layout memos, and a fresh array every render
 * would rebuild the whole graph.
 */
export function filterHiddenTypes(
  nodes: GNode[],
  edges: GEdge[],
  hidden: Set<string>,
  centerId?: string,
): { nodes: GNode[]; edges: GEdge[] } {
  if (hidden.size === 0) return { nodes, edges };
  const visible = nodes.filter((n) => n.id === centerId || !hidden.has(n.type));
  if (visible.length === nodes.length) return { nodes, edges };
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
  /** Relation type key this line stands for. Each line is exactly one relation
   *  type (several may connect the same card pair), so anything derived from the
   *  view — notably "Create diagram" — can stamp the real type instead of
   *  guessing one per card pair. `"hierarchy"` marks a synthetic parent/child line. */
  relType?: string;
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
  /**
   * Aggregate mode: how many relations this one connector stands for. Unset on
   * an ordinary line. Rendered as its own span beside the verb rather than
   * baked into `relLabel`, so the label's length cap can never swallow it and
   * hiding the verbs still leaves the count.
   */
  count?: number;
  /**
   * The card-level endpoints behind this line — one pair on an ordinary line,
   * every merged relation on an aggregate connector. What hover reads to light
   * up exactly the cards a connector stands for, and what its tooltip lists.
   */
  members?: { source: string; target: string }[];
  connectedToHovered?: boolean;
  isHovered?: boolean;
  highlightMode?: boolean;
  /** Idle line style, injected by the view from the shared display settings. */
  lineStyle?: LdvEdgeLineStyle;
  pathOffset?: number;
  minOffset?: number; // minimum offset to clear obstructing nodes
  labelT?: number;
  /** Explicit y for the horizontal run (staggered + kept clear of cards).
   *  Unset on side-handle and obstructed edges — those keep the default
   *  smoothstep shape. */
  centerY?: number;
  /** Channel route: bend points of an orthogonal polyline (endpoints
   *  excluded) for an edge that had to dodge rows of cards between its
   *  endpoints. Mutually exclusive with centerY. */
  waypoints?: { x: number; y: number }[];
  /** Layout-time handle points — lets the renderer detect a stale channel
   *  after a drag and fall back to the default shape. */
  anchors?: { sx: number; sy: number; tx: number; ty: number };
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

  // ONE LINE PER RELATION TYPE.
  //
  // Several relation types may connect the same two cards — an Organization that
  // *owns* an Application and one that *uses* it are different relationships — and
  // each gets its own line, with its own verb, flow direction and description.
  // Collapsing them into a single line labelled "uses / owns" hid that distinction
  // and forced an arbitrary type onto anything derived from the view (the
  // "Create diagram" action stamped only the first).
  //
  // Two rows of the SAME relation type between the same pair (either direction)
  // still collapse to one line — that is a duplicate edge, not a second
  // relationship. Mirrors `GET /reports/dependencies`, which keys on
  // `min:max:type`.
  //
  // Note the dependency TREE deliberately does the opposite (see
  // `dependencyAdjacency.ts`): it renders one child per neighbouring *card*, so
  // joining the verbs there is structural, not a stylistic choice.
  const seen = new Set<string>();
  const dedupedEdges: typeof validEdges = [];
  for (const e of validEdges) {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}||${e.type ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEdges.push(e);
  }

  // Keep metamodel source→target direction on edges. The arrow (markerEnd) must
  // always point from the relation's semantic source to its target so that it
  // matches the metamodel definition. The label is ALWAYS the forward verb — a
  // reader follows the arrowhead, so source-verb-target reads correctly whichever
  // way the layout draws it (see CLAUDE.md on relation edge rendering). `flipped`
  // only tells handle routing to use top→bottom or bottom→top handles.
  const oriented: OrientedEdge[] = dedupedEdges.map((e) => {
    const sP = absPos.get(e.source);
    const tP = absPos.get(e.target);
    // Source→target preserved; flipped when target is above source visually
    const flipped = !!(sP && tP && tP.y < sP.y);
    // Append the relation's single-select attribute value (e.g. " [Leading]").
    const valueSuffix = relValueResolver?.(e) ?? "";
    // The direction is carried on `flowDirection` and rendered as a vector SVG
    // arrow next to the label by the edge component, so it survives image
    // export (a Unicode glyph baked into the text does not — see LdvEdgeData).
    return {
      source: e.source,
      target: e.target,
      relType: e.type,
      relLabel: (e.label || e.type) + valueSuffix,
      description: e.description,
      flipped,
      flowDirection: readFlowDir(e.attributes),
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
        relType: e.relType,
        relLabel: e.relLabel,
        flowDirection: e.flowDirection,
        description: e.description,
        severed,
        pathOffset: routes[i].pathOffset,
        minOffset: routes[i].minOffset,
        labelT: routes[i].labelT,
        ...(routes[i].centerY !== undefined ? { centerY: routes[i].centerY } : {}),
        ...(routes[i].waypoints
          ? { waypoints: routes[i].waypoints, anchors: routes[i].anchors }
          : {}),
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

/* ------------------------------------------------------------------ */
/*  Aggregate mode                                                     */
/* ------------------------------------------------------------------ */

// Re-exported so every consumer — the view, its tests and the `loadDependencyView`
// module namespace extensions receive — reaches the aggregate layout through the
// same module as the plain one.
export {
  buildLdvAggregateFlow,
  LDV_AGGREGATE_LEVELS,
  CL_PAD,
  CL_HEADER_H,
  type LdvAggregateBy,
  type LdvAggregateFlow,
  type LdvClusterData,
} from "./ldvAggregate";

// Moved into `ldvLayoutShared.ts` so the aggregate builder can align its boxes
// with the very same pass; re-exported here because this module is the public
// face of the layout engine, and what `loadDependencyView` hands extensions.
export {
  alignLanesX,
  transposeRow,
  type LaneForAlign,
  type AlignedLane,
} from "./ldvLayoutShared";
