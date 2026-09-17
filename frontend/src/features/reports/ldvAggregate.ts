/**
 * Aggregate layout for the Layered Dependency View — the "show me the shape,
 * not every line" mode asked for in
 * [#1117](https://github.com/vincentmakes/turbo-ea/discussions/1117).
 *
 * Instead of one node per card and one line per relation, the related cards are
 * clustered into boxes and the lines between boxes are merged, each carrying
 * how many relations it stands for. What the cards are grouped BY is the
 * reader's choice — the discussion asks for "card domain, card type, subtype
 * etc." — so `LdvAggregateBy` names the three levels this metamodel actually
 * has: the EA layer (a card type's `category`, which is also the lane it sits
 * in), the card type, and the subtype.
 *
 * Two rules keep the picture honest, and both are load-bearing:
 *
 *  - **The centred card is never clustered.** It is the subject of the diagram,
 *    and the whole point of the mode is reading how that one card relates to
 *    the parts around it. Putting it in a box with its own type's neighbours
 *    would merge the very lines the reader came to see.
 *  - **Relations inside one box stay individual lines.** Merging them would
 *    draw a connector from a box to itself, which says nothing; drawn inside
 *    the box they say exactly what they always did.
 *  - **Two boxes are joined by exactly ONE line**, carrying the number of
 *    relations behind it, whatever their types or directions. Anything else is
 *    the dense picture the reader turned this on to escape.
 *
 * Geometry is not re-invented for any of it: a box is laid out and routed as a
 * **virtual card** through the very engines `buildLdvFlow` uses — `layoutGroup`
 * inside a lane, `alignLanesX` across lanes, `routeLdvEdges` for every line —
 * which now ask each node how big it is instead of assuming 200×80. A second
 * router would have been a second set of rules about ports, obstructions and
 * label placement, and the two would have drifted.
 */

import type { Node, Edge } from "@xyflow/react";
import type { CardType } from "@/types";
import { LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";
import type {
  GNode,
  GEdge,
  LdvNodeData,
  LdvEdgeData,
} from "./layeredDependencyLayout";
import {
  CATEGORY_COLORS,
  layoutGroup,
  type PositionedNode,
  readFlowDir,
  typeCategory,
  typeColor,
  typeIcon,
  typeLabel,
  type FlowDir,
} from "./ldvLayoutShared";
import {
  routeLdvEdges,
  type NodeBounds,
  type Bounds,
  type OrientedEdge,
} from "./ldvEdgeRouting";
import { CARD_SIZE, type NodeSize } from "./ldvHandles";

/** What the related cards are grouped by. `"none"` is the plain card-per-node view. */
export type LdvAggregateBy = "none" | "layer" | "type" | "subtype";

/** Every level, in the order the picker offers them. */
export const LDV_AGGREGATE_LEVELS = ["none", "layer", "type", "subtype"] as const;

/** Padding between a cluster's border and the cards inside it. */
export const CL_PAD = 16;
/** Height of a cluster's title strip. */
export const CL_HEADER_H = 30;
/** A cluster is never narrower than one card plus its padding. */
const CL_MIN_W = LDV_NODE_W + 2 * CL_PAD;
/** How many merged relations a connector's tooltip lists before summarising. */
const MAX_TOOLTIP_LINES = 12;

/** How far a connector keeps from a box it passes beside, and from the next
 *  connector. The card router's 12 / 12 is right for 1 px lines between
 *  cards; a connector is a heavy line standing for many relations, and two
 *  of them 12 px apart along a 400 px box read as one bundle. */
export const CONNECTOR_CLEARANCE = 28;
export const CONNECTOR_SEP = 22;

export interface LdvClusterData {
  /** Stable id of the group — also the React Flow node id. */
  groupKey: string;
  /** Fallback title. The renderer prefers the metamodel resolvers below. */
  label: string;
  color: string;
  icon: string;
  category: string;
  count: number;
  memberIds: string[];
  /** Set on a type / subtype cluster, so the view can resolve a localised label. */
  typeKey?: string;
  /** Set on a subtype cluster whose cards carry a subtype. */
  subtypeKey?: string;
  usedHandles?: string[];
  [key: string]: unknown;
}

export interface LdvAggregateFlow {
  nodes: Node[];
  edges: Edge[];
  /** Card id → the cluster holding it. The centred card is deliberately absent. */
  memberOf: Map<string, string>;
}

interface GroupRef {
  key: string;
  label: string;
  color: string;
  icon: string;
  typeKey?: string;
  subtypeKey?: string;
  /** Sort position: the card type's own, so a type's subtypes stay adjacent. */
  order: number;
  subOrder: number;
}

/**
 * Which box a card belongs in at the chosen level.
 *
 * Only the key has to be unique; the label is a fallback the renderer replaces
 * with the metamodel's localised one, and colour/icon come from the card type
 * so a box reads like the cards it holds.
 */
function groupOf(node: GNode, types: CardType[], level: Exclude<LdvAggregateBy, "none">): GroupRef {
  const tp = types.find((t) => t.key === node.type);
  const typeOrder = tp?.sort_order ?? 0;

  if (level === "layer") {
    const cat = typeCategory(node.type, types);
    return {
      key: `cluster:layer:${cat}`,
      label: cat,
      color: CATEGORY_COLORS[cat] || "#999",
      icon: "layers",
      order: 0,
      subOrder: 0,
    };
  }

  if (level === "type") {
    return {
      key: `cluster:type:${node.type}`,
      label: typeLabel(node.type, types),
      color: typeColor(node.type, types),
      icon: typeIcon(node.type, types),
      typeKey: node.type,
      order: typeOrder,
      subOrder: 0,
    };
  }

  // Subtype: one box per (type, subtype). Cards of a type that carry no subtype
  // keep the bare type as their box, and it sorts after the named ones — the
  // "everything else of this type" bucket reads last.
  const sub = node.subtype || "";
  const subDefs = tp?.subtypes ?? [];
  const subIdx = sub ? subDefs.findIndex((s) => s.key === sub) : -1;
  const subLabel = sub ? subDefs.find((s) => s.key === sub)?.label || sub : "";
  return {
    key: `cluster:subtype:${node.type}:${sub}`,
    label: subLabel ? `${typeLabel(node.type, types)} · ${subLabel}` : typeLabel(node.type, types),
    color: typeColor(node.type, types),
    icon: typeIcon(node.type, types),
    typeKey: node.type,
    subtypeKey: sub || undefined,
    order: typeOrder,
    subOrder: sub ? (subIdx >= 0 ? subIdx : subDefs.length) : subDefs.length + 1,
  };
}

interface ClusterBuild {
  ref: GroupRef;
  members: GNode[];
}

interface MergeAcc {
  /** The pair, in a fixed order so both directions land in one bucket. */
  lo: string;
  hi: string;
  count: number;
  members: { source: string; target: string }[];
  lines: string[];
  /** Relation types merged here — the verb survives only while there is one. */
  relTypes: Set<string>;
  label: string;
  /** Directions seen, as drawn on the pair: true = lo→hi. */
  loToHi: boolean;
  hiToLo: boolean;
  flows: Set<FlowDir | undefined>;
  allSevered: boolean;
}

export function buildLdvAggregateFlow(
  gNodes: GNode[],
  gEdges: GEdge[],
  types: CardType[],
  level: Exclude<LdvAggregateBy, "none">,
  centerId?: string,
  relValueResolver?: (edge: GEdge) => string | undefined,
  /** Renders the "+N more" tail of a connector's tooltip. i18n stays with the caller. */
  moreLabel?: (n: number) => string,
): LdvAggregateFlow {
  if (gNodes.length === 0) return { nodes: [], edges: [], memberOf: new Map() };

  const nodeIdSet = new Set(gNodes.map((n) => n.id));
  const nodeById = new Map(gNodes.map((n) => [n.id, n]));
  const changeStateById = new Map(gNodes.map((n) => [n.id, n.changeState]));
  const validEdges = gEdges.filter(
    (e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target) && e.source !== e.target,
  );

  /* ---- One line per relation type between the same pair (as buildLdvFlow) ---- */
  const seen = new Set<string>();
  const dedupedEdges: GEdge[] = [];
  for (const e of validEdges) {
    const [lo, hi] = e.source < e.target ? [e.source, e.target] : [e.target, e.source];
    const key = `${lo}||${hi}||${e.type ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedEdges.push(e);
  }

  /* ---- Partition the cards into boxes ---- */
  const memberOf = new Map<string, string>();
  const groupRefs = new Map<string, GroupRef>();
  const laneOfGroup = new Map<string, string>();
  // lane → its clusters, and the centred card when it sits there.
  const lanes = new Map<string, { clusters: Map<string, ClusterBuild>; center?: GNode }>();

  const laneFor = (cat: string) => {
    let lane = lanes.get(cat);
    if (!lane) {
      lane = { clusters: new Map() };
      lanes.set(cat, lane);
    }
    return lane;
  };

  for (const n of gNodes) {
    const cat = typeCategory(n.type, types);
    const lane = laneFor(cat);
    if (n.id === centerId) {
      lane.center = n;
      continue;
    }
    const ref = groupOf(n, types, level);
    groupRefs.set(ref.key, ref);
    laneOfGroup.set(ref.key, cat);
    memberOf.set(n.id, ref.key);
    let cl = lane.clusters.get(ref.key);
    if (!cl) {
      cl = { ref, members: [] };
      lane.clusters.set(ref.key, cl);
    }
    cl.members.push(n);
  }


  /* ---- Split the relations: inside one box, or between boxes ----
     Done before layout because the connectors between boxes ARE the edges the
     lane layout is built from — a box is positioned by what it connects to,
     exactly as a card is. */
  const endpointOf = (cardId: string) => memberOf.get(cardId) ?? cardId;
  const intra: GEdge[] = [];
  const merged = new Map<string, MergeAcc>();

  for (const e of dedupedEdges) {
    const ms = endpointOf(e.source);
    const mt = endpointOf(e.target);
    if (ms === mt) {
      intra.push(e);
      continue;
    }
    // ONE LINE BETWEEN TWO BOXES. Every relation joining the same pair collapses
    // into a single connector carrying the total, whatever its type or which way
    // round it runs — that is the whole point of aggregating, and a pair joined
    // by three verbs drawn as three lines is the dense picture the reader was
    // trying to get away from. What each relation was is not lost: the verbs
    // survive on the connector's tooltip, and the arrowheads still show whether
    // the traffic runs one way or both.
    const [lo, hi] = ms < mt ? [ms, mt] : [mt, ms];
    const key = `${lo}||${hi}`;
    const suffix = relValueResolver?.(e) ?? "";
    const verb = e.label || e.type;
    const line = `${verb}: ${nodeById.get(e.source)?.name ?? e.source} → ${
      nodeById.get(e.target)?.name ?? e.target
    }${suffix}`;
    const severed =
      changeStateById.get(e.source) === "retired" || changeStateById.get(e.target) === "retired";
    const forward = ms === lo;
    const acc = merged.get(key);
    if (acc) {
      acc.count += 1;
      acc.members.push({ source: e.source, target: e.target });
      acc.lines.push(line);
      acc.relTypes.add(e.type ?? "");
      acc.loToHi = acc.loToHi || forward;
      acc.hiToLo = acc.hiToLo || !forward;
      acc.flows.add(readFlowDir(e.attributes));
      acc.allSevered = acc.allSevered && severed;
    } else {
      merged.set(key, {
        lo,
        hi,
        count: 1,
        members: [{ source: e.source, target: e.target }],
        lines: [line],
        relTypes: new Set([e.type ?? ""]),
        label: verb,
        loToHi: forward,
        hiToLo: !forward,
        flows: new Set([readFlowDir(e.attributes)]),
        allSevered: severed,
      });
    }
  }
  const mergedList = [...merged.values()];

  /* ---- Lay each box out internally, which is what fixes its size ---- */
  const clusterInner = new Map<string, { positioned: PositionedNode[]; w: number; h: number }>();
  const clusterByKey = new Map<string, ClusterBuild>();
  for (const lane of lanes.values()) {
    for (const cl of lane.clusters.values()) {
      clusterByKey.set(cl.ref.key, cl);
      const ids = new Set(cl.members.map((m) => m.id));
      const inside = dedupedEdges.filter((e) => ids.has(e.source) && ids.has(e.target));
      const { positioned, width, height } = layoutGroup(cl.members, inside);
      clusterInner.set(cl.ref.key, {
        positioned,
        w: Math.max(CL_MIN_W, width + 2 * CL_PAD),
        h: height + CL_HEADER_H + CL_PAD,
      });
    }
  }

  /**
   * How big each virtual node is: a box its own size, the centred card a card.
   * This is what lets the standard layout and routing engines treat a box as a
   * card without knowing anything about boxes.
   */
  const sizeOf = (id: string): NodeSize => {
    const box = clusterInner.get(id);
    return box ? { w: box.w, h: box.h } : CARD_SIZE;
  };

  /* ---- One free layout over the VIRTUAL graph — no layer lanes ----
     The lanes are deliberately dropped while aggregating. Pinning each box to
     the lane of its cards' layer fixes its row before anything is known about
     what it connects to, so boxes that talk to each other end up at opposite
     ends of the canvas and their connectors run the height of the diagram and
     back. Freed, the very same dagre pass the card view uses puts connected
     boxes next to each other and the lines get short. Layer identity is not
     lost: it is what "By layer" groups on, and every box carries its card
     type's own colour and glyph. */
  const virtualNodes: GNode[] = [];
  if (centerId && nodeById.has(centerId)) virtualNodes.push(nodeById.get(centerId)!);
  const orderedClusters = [...clusterByKey.values()].sort(
    (a, b) =>
      a.ref.order - b.ref.order ||
      a.ref.subOrder - b.ref.subOrder ||
      a.ref.key.localeCompare(b.ref.key),
  );
  for (const cl of orderedClusters) {
    virtualNodes.push({
      id: cl.ref.key,
      name: cl.ref.label,
      type: cl.ref.typeKey ?? cl.ref.key,
    });
  }
  if (virtualNodes.length === 0) return { nodes: [], edges: [], memberOf };

  // Dagre ranks by edge direction, so the layout must see each connector the
  // way it is DRAWN — not the alphabetical `lo→hi` the merge keys on. With the
  // drawn orientation, the groups that point INTO the centred card rank above
  // it and the ones it points TO rank below, which splits its connectors over
  // its top and bottom sides. A card has five handle slots per side; feeding
  // dagre the alphabetical order put nine connectors on one side of the
  // centre, two of them sharing a slot and leaving the card from the same
  // point — which is exactly what a duplicate line looks like.
  const virtualEdges: GEdge[] = mergedList.map((m) => {
    const forward = m.loToHi || !m.hiToLo;
    return { source: forward ? m.lo : m.hi, target: forward ? m.hi : m.lo, type: "agg" };
  });
  // Room between boxes for the connectors to run: a corridor keeps
  // CONNECTOR_CLEARANCE from each box and CONNECTOR_SEP from its neighbour,
  // so a gap must hold two clearances plus a few separations — the card
  // defaults (90 / 50) leave nothing for a gap with three lines in it.
  const { positioned } = layoutGroup(virtualNodes, virtualEdges, sizeOf, {
    ranksep: 2 * CONNECTOR_CLEARANCE + 4 * CONNECTOR_SEP,
    nodesep: 2 * CONNECTOR_CLEARANCE + 3 * CONNECTOR_SEP,
  });
  const posById = new Map(positioned.map((p) => [p.id, p]));

  /* ---- Emit nodes: box → its cards (parents before children) ---- */
  const rfNodes: Node[] = [];
  const absCard = new Map<string, { x: number; y: number }>();
  const absVirtual = new Map<string, { x: number; y: number }>();
  const clusterBox = new Map<string, { x: number; y: number; w: number; h: number }>();

  for (const v of virtualNodes) {
    const p = posById.get(v.id);
    if (!p) continue;
    const cl = clusterByKey.get(v.id);

    if (!cl) {
      // The centred card, standing on its own.
      const nd = nodeById.get(v.id)!;
      const centre = { x: p.x + LDV_NODE_W / 2, y: p.y + LDV_NODE_H / 2 };
      rfNodes.push(cardNode(nd, undefined, p.x, p.y, typeCategory(nd.type, types), types));
      absCard.set(nd.id, centre);
      absVirtual.set(nd.id, centre);
      continue;
    }

    const inner = clusterInner.get(cl.ref.key)!;
    rfNodes.push({
      id: cl.ref.key,
      type: "ldvCluster",
      position: { x: p.x, y: p.y },
      style: { width: inner.w, height: inner.h },
      selectable: false,
      draggable: false,
      data: {
        groupKey: cl.ref.key,
        label: cl.ref.label,
        color: cl.ref.color,
        icon: cl.ref.icon,
        category: typeCategory(cl.members[0].type, types),
        count: cl.members.length,
        memberIds: cl.members.map((m) => m.id),
        typeKey: cl.ref.typeKey,
        subtypeKey: cl.ref.subtypeKey,
      } satisfies LdvClusterData,
    });
    clusterBox.set(cl.ref.key, { x: p.x, y: p.y, w: inner.w, h: inner.h });
    absVirtual.set(cl.ref.key, { x: p.x + inner.w / 2, y: p.y + inner.h / 2 });

    for (const mp of inner.positioned) {
      const nd = nodeById.get(mp.id)!;
      const mx = CL_PAD + mp.x;
      const my = CL_HEADER_H + mp.y;
      rfNodes.push(cardNode(nd, cl.ref.key, mx, my, typeCategory(nd.type, types), types));
      absCard.set(nd.id, {
        x: p.x + mx + LDV_NODE_W / 2,
        y: p.y + my + LDV_NODE_H / 2,
      });
    }
  }

  /** Boxes whose vertical spans overlap are one row, which is what tells the
   *  router two nodes sit side by side and may use their facing sides. */
  const rowKeyOf = new Map<string, string>();
  {
    const byY = [...absVirtual.entries()]
      .map(([id, pos]) => ({ id, y: pos.y - sizeOf(id).h / 2, h: sizeOf(id).h }))
      .sort((a, b) => a.y - b.y);
    let row = 0;
    let bottom = -Infinity;
    for (const v of byY) {
      if (bottom !== -Infinity && v.y >= bottom) row++, (bottom = -Infinity);
      rowKeyOf.set(v.id, `row:${row}`);
      bottom = Math.max(bottom, v.y + v.h);
    }
  }

  const rfEdges: Edge[] = [];
  /** Which handles each node ends up using — both routing passes contribute. */
  const handleUse = new Map<string, Set<string>>();
  const collect = (from: Map<string, Set<string>>) => {
    for (const [id, set] of from) {
      const existing = handleUse.get(id);
      if (existing) for (const h of set) existing.add(h);
      else handleUse.set(id, new Set(set));
    }
  };

  /* ---- Pass 1: the connectors BETWEEN boxes, routed as if between cards ----
     Two passes rather than one because obstruction is judged against the nodes
     in play: a box is an obstacle for the lines that pass it, never for the
     lines drawn among its own cards. */
  if (mergedList.length > 0) {
    // Draw each connector the way its relations actually run: one-way keeps a
    // single arrowhead pointing that way, both ways gets an arrow at each end.
    const oriented: OrientedEdge[] = mergedList.map((m) => {
      const forward = m.loToHi || !m.hiToLo;
      const source = forward ? m.lo : m.hi;
      const target = forward ? m.hi : m.lo;
      const sP = absVirtual.get(source);
      const tP = absVirtual.get(target);
      const singleType = m.relTypes.size === 1;
      return {
        source,
        target,
        relType: singleType ? [...m.relTypes][0] || undefined : undefined,
        relLabel: singleType ? m.label : "",
        flipped: !!(sP && tP && tP.y < sP.y),
      };
    });

    // Every box, and the centred card, is an obstacle a connector must route
    // AROUND — through the gaps between them, never across one. A line drawn
    // straight through a box it does not belong to, or through the centred
    // card, is read as a second line between the centre and that box, which is
    // the very thing aggregating exists to remove. The gaps are sized for it
    // above; with the boxes pinned into layer lanes there were no gaps and the
    // router had to detour around everything, which is why the lanes went.
    const boxBounds: NodeBounds[] = [];
    for (const [id, pos] of absVirtual) {
      const { w, h } = sizeOf(id);
      boxBounds.push({
        id,
        x1: pos.x - w / 2,
        y1: pos.y - h / 2,
        x2: pos.x + w / 2,
        y2: pos.y + h / 2,
      });
    }
    const { routes } = routeLdvEdges(
      oriented,
      absVirtual,
      boxBounds,
      boxBounds,
      rowKeyOf,
      sizeOf,
      { clearance: CONNECTOR_CLEARANCE, corridorSep: CONNECTOR_SEP },
    );
    spreadOverflow(routes, oriented, absVirtual);
    // Recomputed from the final routes rather than taken from the router: the
    // spread above moves handles, and a dot drawn for a handle nothing uses is
    // a stray mark on the box.
    const used = new Map<string, Set<string>>();
    oriented.forEach((e, i) => {
      if (!used.has(e.source)) used.set(e.source, new Set());
      if (!used.has(e.target)) used.set(e.target, new Set());
      used.get(e.source)!.add(routes[i].sourceHandle);
      used.get(e.target)!.add(routes[i].targetHandle);
    });
    collect(used);

    mergedList.forEach((m, i) => {
      const o = oriented[i];
      const bothWays = m.loToHi && m.hiToLo;
      // The verb survives only while the connector stands for ONE relation
      // type; naming one of several would be a claim about the others. The
      // count is always there, and the tooltip names every verb behind it.
      const singleType = m.relTypes.size === 1;
      // `flowDirection` describes traffic along a single relation type; with
      // several merged, or with relations running both ways, the arrowheads
      // below say it instead.
      const flow = !bothWays && singleType && m.flows.size === 1 ? [...m.flows][0] : undefined;
      const arrow = { type: "arrowclosed" as const, color: m.allSevered ? "#d32f2f" : "#888" };
      const markerStart =
        bothWays || flow === "reverse" || flow === "bidirectional" ? arrow : undefined;
      const markerEnd = !bothWays && flow === "reverse" ? undefined : arrow;
      const shown = m.lines.slice(0, MAX_TOOLTIP_LINES);
      const rest = m.lines.length - shown.length;
      const description =
        rest > 0 && moreLabel ? [...shown, moreLabel(rest)].join("\n") : shown.join("\n");
      rfEdges.push({
        id: `ldve-agg-${i}`,
        source: o.source,
        target: o.target,
        sourceHandle: routes[i].sourceHandle,
        targetHandle: routes[i].targetHandle,
        type: "ldvEdge",
        label: o.relLabel,
        data: {
          ...(o.relType ? { relType: o.relType } : {}),
          relLabel: o.relLabel,
          count: m.count,
          members: m.members,
          flowDirection: flow,
          description,
          severed: m.allSevered,
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
      });
    });
  }

  /* ---- Pass 2: the lines among the cards inside one box ---- */
  if (intra.length > 0) {
    const oriented: OrientedEdge[] = intra.map((e) => {
      const sP = absCard.get(e.source);
      const tP = absCard.get(e.target);
      const valueSuffix = relValueResolver?.(e) ?? "";
      return {
        source: e.source,
        target: e.target,
        relType: e.type,
        relLabel: (e.label || e.type) + valueSuffix,
        description: e.description,
        flipped: !!(sP && tP && tP.y < sP.y),
        flowDirection: readFlowDir(e.attributes),
      };
    });
    const cardBounds: NodeBounds[] = [];
    for (const [id, pos] of absCard) {
      cardBounds.push({
        id,
        x1: pos.x - LDV_NODE_W / 2,
        y1: pos.y - LDV_NODE_H / 2,
        x2: pos.x + LDV_NODE_W / 2,
        y2: pos.y + LDV_NODE_H / 2,
      });
    }
    const boxHeaderBounds: Bounds[] = [...clusterBox.values()].map((b) => ({
      x1: b.x,
      y1: b.y,
      x2: b.x + b.w,
      y2: b.y + CL_HEADER_H,
    }));
    // To the router "same lane" means "route sideways rather than top to
    // bottom", and inside a box that is exactly what the box is.
    const laneOfCard = new Map<string, string>();
    for (const [cardId, boxId] of memberOf) laneOfCard.set(cardId, boxId);

    const { routes, usedHandles } = routeLdvEdges(
      oriented,
      absCard,
      cardBounds,
      boxHeaderBounds,
      laneOfCard,
    );
    collect(usedHandles);

    oriented.forEach((e, i) => {
      const severed =
        changeStateById.get(e.source) === "retired" || changeStateById.get(e.target) === "retired";
      const arrow = { type: "arrowclosed" as const, color: severed ? "#d32f2f" : "#888" };
      const markerStart =
        e.flowDirection === "reverse" || e.flowDirection === "bidirectional" ? arrow : undefined;
      const markerEnd = e.flowDirection === "reverse" ? undefined : arrow;
      rfEdges.push({
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
          members: [{ source: e.source, target: e.target }],
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
      });
    });
  }

  /* ---- Only the handles an edge actually uses are rendered ---- */
  for (const n of rfNodes) {
    if (n.type === "ldvNode") {
      (n.data as LdvNodeData).usedHandles = [...(handleUse.get(n.id) ?? [])];
    } else if (n.type === "ldvCluster") {
      (n.data as LdvClusterData).usedHandles = [...(handleUse.get(n.id) ?? [])];
    }
  }

  return { nodes: rfNodes, edges: rfEdges, memberOf };
}

/** Handle slots per side — the five top/bottom positions of `LDV_HANDLE_SPECS`. */
const SLOTS_PER_SIDE = 5;
/** Stagger between connectors that still have to share a handle (last resort). */
const SHARED_HANDLE_STEP = 14;

/**
 * No two connectors may leave one node from the same point.
 *
 * A node has five handle slots on its top and five on its bottom; the router
 * lets a sixth line on a side share a slot, which is exactly what a duplicate
 * line looks like — two strokes leaving the same point and only later parting.
 * A hub with many groups around it (the centred card by subtype: seven below)
 * hits this at once. So a side's overflow moves to the node's free LEFT and
 * RIGHT handles, leftmost partner to the left and rightmost to the right, and
 * only what still cannot be placed shares a slot — with a distinct stub length
 * each, so the strokes part immediately rather than running together.
 *
 * Mutates `routes` in place. Pure otherwise, and pinned by the demo-landscape
 * guard test (`never lets two connectors leave one node from the same point`).
 */
function spreadOverflow(
  routes: { sourceHandle: string; targetHandle: string; pathOffset: number }[],
  oriented: OrientedEdge[],
  absPos: Map<string, { x: number; y: number }>,
): void {
  type Att = { idx: number; role: "source" | "target"; otherX: number };
  const bySide = new Map<string, Att[]>();
  const sideOf = (h: string) => h.replace(/-\d+$/, "");
  const key = (node: string, side: string) => `${node}||${side}`;
  oriented.forEach((e, i) => {
    const push = (node: string, h: string, role: Att["role"], other: string) => {
      const k = key(node, sideOf(h));
      if (!bySide.has(k)) bySide.set(k, []);
      bySide.get(k)!.push({ idx: i, role, otherX: absPos.get(other)?.x ?? 0 });
    };
    push(e.source, routes[i].sourceHandle, "source", e.target);
    push(e.target, routes[i].targetHandle, "target", e.source);
  });

  const setHandle = (a: Att, h: string) => {
    if (a.role === "source") routes[a.idx].sourceHandle = h;
    else routes[a.idx].targetHandle = h;
  };
  const sideHandle = (role: Att["role"], side: "left" | "right") =>
    side === "left" ? (role === "source" ? "left-src" : "left") : role === "source" ? "right" : "right-tgt";

  for (const [k, atts] of bySide) {
    const [node, side] = k.split("||");
    if (side !== "t" && side !== "ts" && side !== "b" && side !== "bt") continue;
    if (atts.length <= SLOTS_PER_SIDE) continue;
    const sorted = [...atts].sort((a, b) => a.otherX - b.otherX || a.idx - b.idx);
    const extras = sorted.length - SLOTS_PER_SIDE;
    // Take the overflow from the two ends, where a side handle is the natural
    // exit anyway; what is left in the middle keeps its slot.
    const moved: Att[] = [];
    const leftFree = !(bySide.get(key(node, "left")) ?? bySide.get(key(node, "left-src")))?.length;
    const rightFree = !(bySide.get(key(node, "right")) ?? bySide.get(key(node, "right-tgt")))?.length;
    if (extras >= 1 && leftFree) {
      const a = sorted[0];
      setHandle(a, sideHandle(a.role, "left"));
      moved.push(a);
    }
    if (extras >= 2 && rightFree) {
      const a = sorted[sorted.length - 1];
      setHandle(a, sideHandle(a.role, "right"));
      moved.push(a);
    }
    // Whatever still shares a slot gets its own stub length.
    const remaining = sorted.filter((a) => !moved.includes(a));
    const handleOf = (a: Att) => (a.role === "source" ? routes[a.idx].sourceHandle : routes[a.idx].targetHandle);
    const seen = new Map<string, number>();
    for (const a of remaining) {
      const h = handleOf(a);
      const n = seen.get(h) ?? 0;
      if (n > 0) routes[a.idx].pathOffset = routes[a.idx].pathOffset + n * SHARED_HANDLE_STEP;
      seen.set(h, n + 1);
    }
  }
}

/** A member (or the centred) card, in the same shape `buildLdvFlow` emits. */
function cardNode(
  nd: GNode,
  parentId: string | undefined,
  x: number,
  y: number,
  category: string,
  types: CardType[],
): Node {
  return {
    id: nd.id,
    type: "ldvNode",
    position: { x, y },
    ...(parentId ? { parentId, extent: "parent" as const } : {}),
    data: {
      name: nd.name,
      typeKey: nd.type,
      typeLabel: typeLabel(nd.type, types),
      subtypeKey: nd.subtype,
      typeColor: typeColor(nd.type, types),
      typeIcon: typeIcon(nd.type, types),
      category,
      proposed: nd.proposed,
      changeState: nd.changeState,
      gainedLink: nd.gainedLink,
      lostLink: nd.lostLink,
    } satisfies LdvNodeData,
    style: { width: LDV_NODE_W, height: LDV_NODE_H },
    draggable: false,
  };
}
