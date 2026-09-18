/**
 * What the Layered Dependency View hands `buildLdvDiagramXml` when the reader
 * asks for a diagram: the on-screen nodes and edges, translated into the
 * cards, relation lines, layer lanes, group boxes and merged connectors a
 * DrawIO diagram is made of.
 *
 * A pure function over React Flow's LIVE nodes (positions after any drag) and
 * the view's built edges, kept out of the view so it can be tested under
 * jsdom, where React Flow cannot lay the view out. Both modes flow through
 * it: a plain view yields cards, lines and lanes; an aggregated view yields
 * cards nested in their boxes, the lines drawn inside a box, and one
 * connector per box pair carrying its count.
 */
import type { Node, Edge } from "@xyflow/react";
import type {
  CardDetailLine,
  DiagramCardInput,
  DiagramConnectorInput,
  DiagramGroupInput,
  DiagramLayerInput,
  DiagramRelInput,
} from "@/features/diagrams/drawio-shapes";
import {
  LDV_NODE_W,
  LDV_NODE_H,
  type LdvNodeData,
  type LdvGroupData,
  type LdvEdgeData,
  type LdvClusterData,
} from "./layeredDependencyLayout";
import { absolutePosition, exportRoute, type XY } from "./ldvEdgeRouting";

export interface DiagramInputs {
  cards: DiagramCardInput[];
  rels: DiagramRelInput[];
  layers: DiagramLayerInput[];
  groups: DiagramGroupInput[];
  connectors: DiagramConnectorInput[];
}

export interface CollectOptions {
  /** The "[Application]" row an LDV card renders separately from its
   *  `extraLines`; supplied by the caller (it needs i18n) when the view shows
   *  the type, omitted otherwise. */
  typeRow?: (d: LdvNodeData) => CardDetailLine;
}

function sizeOf(n: Node): { w: number; h: number } {
  return {
    w: (n.style?.width as number) ?? LDV_NODE_W,
    h: (n.style?.height as number) ?? LDV_NODE_H,
  };
}

/**
 * Translate the live graph into diagram inputs.
 *
 * Coordinates: everything is written in absolute graph space, except a card
 * inside a group box, whose position stays RELATIVE to the box — it becomes
 * the box's mxGraph child, and that is what a child's geometry means. Cards
 * inside a layer lane are absolute: lanes export as background rectangles,
 * not containers, exactly as before.
 */
export function collectDiagramInputs(
  live: Node[],
  edges: Edge[],
  opts: CollectOptions = {},
): DiagramInputs {
  const byId = new Map(live.map((n) => [n.id, n]));
  const absOf = (n: Node): XY => absolutePosition(n, byId);
  const isBox = (id: string | undefined) => !!id && byId.get(id)?.type === "ldvCluster";

  const cards: DiagramCardInput[] = [];
  const layers: DiagramLayerInput[] = [];
  const groups: DiagramGroupInput[] = [];
  const exported = new Set<string>(); // card ids and group keys a line may reference

  for (const n of live) {
    if (n.type === "ldvNode") {
      const d = n.data as LdvNodeData;
      if (d.proposed) continue; // proposed cards have no inventory id
      const inBox = isBox(n.parentId);
      const p = inBox ? n.position : absOf(n);
      const { w, h } = sizeOf(n);
      cards.push({
        cardId: n.id,
        cardType: d.typeKey,
        name: d.name,
        color: d.typeColor,
        icon: d.typeIcon,
        // Carry across exactly what the reader is looking at. `extraLines`
        // already holds the subtype row and the picked attribute rows,
        // resolved and formatted; the type row is rendered separately on an
        // LDV node, so it is prepended here.
        detailLines: [
          ...(opts.typeRow ? [opts.typeRow(d)] : []),
          ...((d.extraLines as CardDetailLine[] | undefined) ?? []),
        ],
        x: p.x,
        y: p.y,
        w,
        h,
        ...(inBox ? { groupKey: n.parentId } : {}),
      });
      exported.add(n.id);
    } else if (n.type === "ldvGroup") {
      const d = n.data as LdvGroupData;
      const p = absOf(n);
      const { w, h } = sizeOf(n);
      layers.push({ label: d.label, color: d.color, x: p.x, y: p.y, w, h });
    } else if (n.type === "ldvCluster") {
      const d = n.data as LdvClusterData;
      const p = absOf(n);
      const { w, h } = sizeOf(n);
      groups.push({ key: n.id, label: `${d.label} (${d.count})`, color: d.color, x: p.x, y: p.y, w, h });
      exported.add(n.id);
    }
  }

  // Centres of EVERY node in the space the shapes are written in, so the
  // view's own route can travel onto the diagram unchanged. Boxes and the
  // centred card (which has no parent) are endpoints too, so this cannot be
  // limited to cards inside a parent the way the renderer's helper is.
  const centres = new Map<string, XY>();
  for (const n of live) {
    const p = absOf(n);
    const { w, h } = sizeOf(n);
    centres.set(n.id, { x: p.x + w / 2, y: p.y + h / 2 });
  }

  const rels: DiagramRelInput[] = [];
  const connectors: DiagramConnectorInput[] = [];
  for (const e of edges) {
    if (!exported.has(e.source) || !exported.has(e.target)) continue;
    const d = e.data as LdvEdgeData | undefined;
    const route = exportRoute({
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      sourceCentre: centres.get(e.source),
      targetCentre: centres.get(e.target),
      waypoints: d?.waypoints,
      centerY: d?.centerY,
      anchors: d?.anchors,
    });
    if (d?.count !== undefined) {
      // A merged connector: its endpoints are boxes, or a lone card and a
      // box. The verb survives only while it stands for one relation type —
      // the builder already blanked it otherwise.
      connectors.push({
        sourceKey: e.source,
        targetKey: e.target,
        label: d.relLabel ?? "",
        count: d.count,
        flow: d.flowDirection,
        ...route,
      });
      continue;
    }
    rels.push({
      sourceCardId: e.source,
      targetCardId: e.target,
      // Each line IS one relation type (several may connect a card pair), so
      // take it off the edge rather than guessing one per pair. Synthetic
      // hierarchy lines are not relations and carry no type.
      relationType: d?.relType && d.relType !== "hierarchy" ? d.relType : "",
      label: d?.relLabel ?? "",
      flow: d?.flowDirection,
      ...route,
    });
  }

  return { cards, rels, layers, groups, connectors };
}
