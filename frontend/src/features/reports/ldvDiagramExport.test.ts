/**
 * What the view hands the DrawIO serialiser, in both modes, built from the
 * real demo landscape (the depth-1 neighbourhood of SAP S/4HANA).
 */
import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import demo from "./__fixtures__/demoDependencies.json";
import { buildLdvAggregateFlow } from "./ldvAggregate";
import { buildLdvFlow, type GNode, type GEdge, type LdvEdgeData } from "./layeredDependencyLayout";
import { collectDiagramInputs } from "./ldvDiagramExport";
import type { CardType } from "@/types";

const nodes = demo.nodes as unknown as GNode[];
const edges = demo.edges as unknown as GEdge[];
const types = demo.types as unknown as CardType[];
const CENTER = demo.centerId as string;

describe("collectDiagramInputs — aggregated view", () => {
  const flow = buildLdvAggregateFlow(nodes, edges, types, "type", CENTER);
  const inputs = collectDiagramInputs(flow.nodes as Node[], flow.edges);
  const boxes = flow.nodes.filter((n) => n.type === "ldvCluster");

  it("exports every box as a group and every card, nested where it was", () => {
    expect(inputs.groups.map((g) => g.key).sort()).toEqual(boxes.map((b) => b.id).sort());
    expect(inputs.layers).toEqual([]);
    const cardNodes = flow.nodes.filter((n) => n.type === "ldvNode");
    expect(inputs.cards).toHaveLength(cardNodes.length);
    for (const n of cardNodes) {
      const card = inputs.cards.find((c) => c.cardId === n.id)!;
      if (n.parentId) {
        // A member is its box's child: relative position, same as React Flow's.
        expect(card.groupKey).toBe(n.parentId);
        expect(card.x).toBe(n.position.x);
        expect(card.y).toBe(n.position.y);
      } else {
        expect(card.groupKey).toBeUndefined();
        expect(n.id).toBe(CENTER);
      }
    }
  });

  it("titles a group the way the box is headed, with its count", () => {
    for (const g of inputs.groups) {
      expect(g.label).toMatch(/\(\d+\)$/);
    }
  });

  it("turns every counted line into a connector with the same count, and nothing else", () => {
    const counted = flow.edges.filter((e) => (e.data as LdvEdgeData).count !== undefined);
    expect(inputs.connectors).toHaveLength(counted.length);
    const total = counted.reduce((s, e) => s + ((e.data as LdvEdgeData).count ?? 0), 0);
    expect(inputs.connectors.reduce((s, c) => s + c.count, 0)).toBe(total);
    const keys = new Set([...inputs.groups.map((g) => g.key), ...inputs.cards.map((c) => c.cardId)]);
    for (const c of inputs.connectors) {
      expect(keys.has(c.sourceKey)).toBe(true);
      expect(keys.has(c.targetKey)).toBe(true);
      expect(c.exit).toBeDefined();
      expect(c.entry).toBeDefined();
    }
  });

  it("keeps the lines drawn inside a box as relation lines", () => {
    const inside = flow.edges.filter((e) => (e.data as LdvEdgeData).count === undefined);
    expect(inputs.rels).toHaveLength(inside.length);
    for (const r of inputs.rels) {
      const s = inputs.cards.find((c) => c.cardId === r.sourceCardId)!;
      const t = inputs.cards.find((c) => c.cardId === r.targetCardId)!;
      expect(s.groupKey).toBe(t.groupKey);
      expect(r.relationType).not.toBe("");
    }
  });

  it("carries the route of a connector, from a box's centre, when it is fresh", () => {
    // Layout output IS the live state before any drag, so every stored route
    // still meets its handles and travels as waypoints.
    const withRoute = inputs.connectors.filter((c) => c.waypoints?.length);
    expect(withRoute.length).toBeGreaterThan(0);
  });

  it("prepends the type row when the view shows it", () => {
    const withType = collectDiagramInputs(flow.nodes as Node[], flow.edges, {
      typeRow: (d) => ({ label: "Type", value: d.typeLabel || d.typeKey }),
    });
    for (const c of withType.cards) {
      expect(c.detailLines?.[0]).toEqual({ label: "Type", value: expect.any(String) });
    }
  });
});

describe("collectDiagramInputs — plain view", () => {
  const flow = buildLdvFlow(nodes, edges, types);
  const inputs = collectDiagramInputs(flow.nodes as Node[], flow.edges);

  it("yields cards, lines and lanes, and no groups or connectors", () => {
    expect(inputs.groups).toEqual([]);
    expect(inputs.connectors).toEqual([]);
    expect(inputs.layers.length).toBeGreaterThan(0);
    expect(inputs.cards).toHaveLength(flow.nodes.filter((n) => n.type === "ldvNode").length);
    expect(inputs.rels).toHaveLength(flow.edges.length);
    for (const c of inputs.cards) expect(c.groupKey).toBeUndefined();
  });

  it("writes a card inside a lane at its absolute position", () => {
    const child = flow.nodes.find((n) => n.type === "ldvNode" && n.parentId)!;
    const lane = flow.nodes.find((n) => n.id === child.parentId)!;
    const card = inputs.cards.find((c) => c.cardId === child.id)!;
    expect(card.x).toBe(lane.position.x + child.position.x);
    expect(card.y).toBe(lane.position.y + child.position.y);
  });
});
