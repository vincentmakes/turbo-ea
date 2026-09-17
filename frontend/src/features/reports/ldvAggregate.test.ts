/**
 * The Layered Dependency View's aggregate layout — the boxes-and-counts mode
 * from discussion #1117.
 *
 * Three rules carry the whole feature and each is asserted here, because each
 * is the kind of thing a later "simplification" would quietly undo: the centred
 * card is never put in a box, relations between two cards of one box stay
 * individual lines, and two boxes are joined by exactly ONE line carrying the
 * number of relations behind it — whatever their types or directions.
 */
import { describe, it, expect } from "vitest";
import { buildLdvAggregateFlow, type LdvClusterData } from "./ldvAggregate";
import type { GNode, GEdge, LdvEdgeData } from "./layeredDependencyLayout";
import type { CardType } from "@/types";

function makeType(overrides: Partial<CardType> & { key: string }): CardType {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    icon: overrides.icon ?? "description",
    color: overrides.color ?? "#999",
    category: overrides.category ?? "Other",
    has_hierarchy: false,
    has_successors: false,
    built_in: true,
    is_hidden: false,
    sort_order: overrides.sort_order ?? 0,
    subtypes: overrides.subtypes ?? [],
    fields_schema: [],
    section_config: {},
    stakeholder_roles: [],
    translations: {},
  } as CardType;
}

const APP_TYPE = makeType({
  key: "Application",
  label: "Application",
  category: "Application & Data",
  sort_order: 1,
  subtypes: [
    { key: "businessApplication", label: "Business Application" },
    { key: "microservice", label: "Microservice" },
  ],
} as Partial<CardType> & { key: string });

const IT_TYPE = makeType({
  key: "ITComponent",
  label: "IT Component",
  category: "Technical Architecture",
  sort_order: 2,
});

const ORG_TYPE = makeType({
  key: "Organization",
  label: "Organization",
  category: "Business Architecture",
  sort_order: 3,
});

const TYPES = [APP_TYPE, IT_TYPE, ORG_TYPE];

function card(id: string, type: string, name = id, subtype?: string): GNode {
  return { id, name, type, ...(subtype ? { subtype } : {}) };
}

const clusters = (nodes: ReturnType<typeof buildLdvAggregateFlow>["nodes"]) =>
  nodes.filter((n) => n.type === "ldvCluster");
const edgeData = (e: { data?: unknown }) => e.data as LdvEdgeData;

describe("buildLdvAggregateFlow", () => {
  it("returns nothing for an empty graph", () => {
    const flow = buildLdvAggregateFlow([], [], TYPES, "type");
    expect(flow.nodes).toEqual([]);
    expect(flow.edges).toEqual([]);
    expect(flow.memberOf.size).toBe(0);
  });

  it("puts one box per card type in each lane, and every card inside one", () => {
    const nodes = [
      card("a1", "Application"),
      card("a2", "Application"),
      card("i1", "ITComponent"),
    ];
    const flow = buildLdvAggregateFlow(nodes, [], TYPES, "type");
    const boxes = clusters(flow.nodes);
    expect(boxes.map((b) => b.id).sort()).toEqual([
      "cluster:type:Application",
      "cluster:type:ITComponent",
    ]);
    expect((boxes.find((b) => b.id === "cluster:type:Application")!.data as LdvClusterData).count).toBe(2);
    expect(flow.memberOf.get("a1")).toBe("cluster:type:Application");
    expect(flow.memberOf.get("i1")).toBe("cluster:type:ITComponent");
  });

  it("emits every parent before its children, as React Flow requires", () => {
    const flow = buildLdvAggregateFlow(
      [card("a1", "Application"), card("i1", "ITComponent")],
      [],
      TYPES,
      "type",
    );
    const seen = new Set<string>();
    for (const n of flow.nodes) {
      if (n.parentId) expect(seen.has(n.parentId)).toBe(true);
      seen.add(n.id);
    }
  });

  it("leaves the centred card out of every box", () => {
    // It is the subject of the diagram: boxing it with its own type's
    // neighbours would merge away the very lines the reader came to see.
    const nodes = [card("center", "Application"), card("a2", "Application")];
    const flow = buildLdvAggregateFlow(nodes, [], TYPES, "type", "center");
    expect(flow.memberOf.has("center")).toBe(false);
    const centreNode = flow.nodes.find((n) => n.id === "center")!;
    expect(centreNode.type).toBe("ldvNode");
    expect(centreNode.parentId).toBe("group:Application & Data");
    expect(flow.memberOf.get("a2")).toBe("cluster:type:Application");
  });

  it("merges the lines into one connector per box pair and relation type", () => {
    const nodes = [
      card("center", "Organization", "ACME"),
      card("a1", "Application", "ERP"),
      card("a2", "Application", "CRM"),
    ];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
      { source: "center", target: "a2", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges).toHaveLength(1);
    const d = edgeData(flow.edges[0]);
    expect(d.relLabel).toBe("uses");
    expect(d.count).toBe(2);
    expect(d.members).toEqual([
      { source: "center", target: "a1" },
      { source: "center", target: "a2" },
    ]);
    expect(flow.edges[0].source).toBe("center");
    expect(flow.edges[0].target).toBe("cluster:type:Application");
  });

  it("draws ONE line for two relation types between the same boxes", () => {
    // The whole point of aggregating: a pair joined by three verbs drawn as
    // three lines is the dense picture the reader turned this on to escape.
    const nodes = [
      card("center", "Organization"),
      card("a1", "Application"),
      card("a2", "Application"),
    ];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToAppOwns", label: "owns" },
      { source: "center", target: "a2", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges).toHaveLength(1);
    expect(edgeData(flow.edges[0]).count).toBe(2);
    // Naming one of two verbs would be a claim about the other, so the line
    // carries only its count — and the tooltip names both.
    expect(edgeData(flow.edges[0]).relLabel).toBe("");
    expect(edgeData(flow.edges[0]).description).toContain("owns:");
    expect(edgeData(flow.edges[0]).description).toContain("uses:");
  });

  it("keeps the verb while the line stands for a single relation type", () => {
    const nodes = [
      card("center", "Organization"),
      card("a1", "Application"),
      card("a2", "Application"),
    ];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
      { source: "center", target: "a2", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(edgeData(flow.edges[0]).relLabel).toBe("uses");
  });

  it("draws ONE line when relations run both ways, arrowed at both ends", () => {
    const nodes = [
      card("center", "Organization"),
      card("a1", "Application"),
      card("a2", "Application"),
    ];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
      { source: "a2", target: "center", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges).toHaveLength(1);
    expect(edgeData(flow.edges[0]).count).toBe(2);
    expect(flow.edges[0].markerStart).toBeDefined();
    expect(flow.edges[0].markerEnd).toBeDefined();
  });

  it("points a one-way line the way its relations run", () => {
    const nodes = [card("center", "Organization"), card("a1", "Application")];
    const edges: GEdge[] = [
      { source: "a1", target: "center", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges[0].source).toBe("cluster:type:Application");
    expect(flow.edges[0].target).toBe("center");
    expect(flow.edges[0].markerStart).toBeUndefined();
    expect(flow.edges[0].markerEnd).toBeDefined();
  });

  it("leaves a relation between two cards of one box drawn inside it", () => {
    // Merging it would draw a connector from a box to itself, which says
    // nothing the box does not already say.
    const nodes = [card("a1", "Application"), card("a2", "Application")];
    const edges: GEdge[] = [{ source: "a1", target: "a2", type: "relAppToApp", label: "calls" }];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type");
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0].source).toBe("a1");
    expect(flow.edges[0].target).toBe("a2");
    expect(edgeData(flow.edges[0]).count).toBeUndefined();
  });

  it("carries a flow direction only when every merged relation agrees", () => {
    const nodes = [
      card("center", "Organization"),
      card("a1", "Application"),
      card("a2", "Application"),
    ];
    const agreeing: GEdge[] = [
      {
        source: "center",
        target: "a1",
        type: "relOrgToApp",
        label: "uses",
        attributes: { flowDirection: "reverse" },
      },
      {
        source: "center",
        target: "a2",
        type: "relOrgToApp",
        label: "uses",
        attributes: { flowDirection: "reverse" },
      },
    ];
    expect(
      edgeData(buildLdvAggregateFlow(nodes, agreeing, TYPES, "type", "center").edges[0])
        .flowDirection,
    ).toBe("reverse");

    const mixed: GEdge[] = [
      agreeing[0],
      {
        source: "center",
        target: "a2",
        type: "relOrgToApp",
        label: "uses",
        attributes: { flowDirection: "forward" },
      },
    ];
    expect(
      edgeData(buildLdvAggregateFlow(nodes, mixed, TYPES, "type", "center").edges[0]).flowDirection,
    ).toBeUndefined();
  });

  it("severs a connector only when every relation it merged is severed", () => {
    const base = [
      card("center", "Organization"),
      { ...card("a1", "Application"), changeState: "retired" as const },
      card("a2", "Application"),
    ];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
      { source: "center", target: "a2", type: "relOrgToApp", label: "uses" },
    ];
    expect(
      edgeData(buildLdvAggregateFlow(base, edges, TYPES, "type", "center").edges[0]).severed,
    ).toBe(false);

    const allRetired = [
      base[0],
      base[1],
      { ...card("a2", "Application"), changeState: "retired" as const },
    ];
    expect(
      edgeData(buildLdvAggregateFlow(allRetired, edges, TYPES, "type", "center").edges[0]).severed,
    ).toBe(true);
  });

  it("lists the merged relations in the connector's tooltip, summarising a long list", () => {
    const nodes = [card("center", "Organization", "ACME")];
    const edges: GEdge[] = [];
    for (let i = 0; i < 15; i++) {
      nodes.push(card(`a${i}`, "Application", `App ${i}`));
      edges.push({ source: "center", target: `a${i}`, type: "relOrgToApp", label: "uses" });
    }
    const flow = buildLdvAggregateFlow(
      nodes,
      edges,
      TYPES,
      "type",
      "center",
      undefined,
      (n) => `+${n} more`,
    );
    const lines = edgeData(flow.edges[0]).description!.split("\n");
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe("uses: ACME → App 0");
    expect(lines[12]).toBe("+3 more");
  });

  it("groups by subtype, with the cards that have none in their own box last", () => {
    const nodes = [
      card("a1", "Application", "ERP", "businessApplication"),
      card("a2", "Application", "Auth", "microservice"),
      card("a3", "Application", "Legacy"),
    ];
    const flow = buildLdvAggregateFlow(nodes, [], TYPES, "subtype");
    const boxes = clusters(flow.nodes);
    expect(boxes.map((b) => b.id)).toEqual([
      "cluster:subtype:Application:businessApplication",
      "cluster:subtype:Application:microservice",
      "cluster:subtype:Application:",
    ]);
    const bare = boxes[2].data as LdvClusterData;
    expect(bare.subtypeKey).toBeUndefined();
    expect(bare.label).toBe("Application");
    expect((boxes[0].data as LdvClusterData).label).toBe("Application · Business Application");
  });

  it("groups by layer into one box per lane", () => {
    const nodes = [
      card("a1", "Application"),
      card("a2", "Application"),
      card("i1", "ITComponent"),
    ];
    const flow = buildLdvAggregateFlow(nodes, [], TYPES, "layer");
    const boxes = clusters(flow.nodes);
    expect(boxes.map((b) => b.id)).toEqual([
      "cluster:layer:Application & Data",
      "cluster:layer:Technical Architecture",
    ]);
    expect((boxes[0].data as LdvClusterData).count).toBe(2);
  });

  it("drops the lane's title when its one box would repeat it", () => {
    // Grouping by layer names the box after the lane it fills, and two
    // identical titles one inside the other read as a rendering fault.
    const flow = buildLdvAggregateFlow(
      [card("a1", "Application"), card("a2", "Application")],
      [],
      TYPES,
      "layer",
    );
    const lane = flow.nodes.find((n) => n.type === "ldvGroup")!;
    expect((lane.data as { label: string }).label).toBe("");
    expect((clusters(flow.nodes)[0].data as LdvClusterData).label).toBe("Application & Data");
  });

  it("keeps the lane's title when the box is only part of the lane", () => {
    // The centred card sits beside the box, so the lane holds more than the
    // box and its own name is still telling the reader something.
    const flow = buildLdvAggregateFlow(
      [card("center", "Application"), card("a2", "Application")],
      [],
      TYPES,
      "layer",
      "center",
    );
    const lane = flow.nodes.find((n) => n.type === "ldvGroup")!;
    expect((lane.data as { label: string }).label).toBe("Application & Data");
  });

  it("keeps the lane's title when grouping by type, where the names differ", () => {
    const flow = buildLdvAggregateFlow([card("a1", "Application")], [], TYPES, "type");
    const lane = flow.nodes.find((n) => n.type === "ldvGroup")!;
    expect((lane.data as { label: string }).label).toBe("Application & Data");
  });

  it("never lets two boxes overlap, whatever their sizes", () => {
    // Both size traps the card case hid land here: `transposeRow` swapping two
    // x positions of unequal width, and `alignLanesX` bucketing rows by
    // top-edge y so two boxes of different heights on one rank never got kept
    // apart. Each shipped as boxes drawn on top of each other.
    const nodes: GNode[] = [card("center", "Organization", "ACME")];
    const edges: GEdge[] = [];
    // A fat box and a thin one in the same lane, both tied to the centre.
    for (let i = 0; i < 9; i++) {
      nodes.push(card(`app${i}`, "Application", `App ${i}`));
      edges.push({ source: "center", target: `app${i}`, type: "relOrgToApp", label: "uses" });
    }
    nodes.push(card("itc", "ITComponent", "One Component"));
    edges.push({ source: "center", target: "itc", type: "relOrgToITC", label: "runs on" });
    nodes.push(card("org2", "Organization", "Sub Unit"));
    edges.push({ source: "center", target: "org2", type: "relOrgToOrg", label: "owns" });

    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    const laneOf = new Map(flow.nodes.map((n) => [n.id, n.parentId]));
    const lanePos = new Map(
      flow.nodes.filter((n) => n.type === "ldvGroup").map((n) => [n.id, n.position]),
    );
    const boxes = flow.nodes
      .filter((n) => n.type === "ldvCluster" || (n.type === "ldvNode" && n.id === "center"))
      .map((n) => {
        const lane = lanePos.get(laneOf.get(n.id) as string)!;
        const w = (n.style?.width as number) ?? 200;
        const h = (n.style?.height as number) ?? 80;
        return {
          id: n.id,
          x1: lane.x + n.position.x,
          y1: lane.y + n.position.y,
          x2: lane.x + n.position.x + w,
          y2: lane.y + n.position.y + h,
        };
      });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b2 = boxes[j];
        const overlaps = a.x1 < b2.x2 && a.x2 > b2.x1 && a.y1 < b2.y2 && a.y2 > b2.y1;
        expect(`${a.id} vs ${b2.id}: ${overlaps}`).toBe(`${a.id} vs ${b2.id}: false`);
      }
    }
  });

  it("routes every line through the standard engine, bends and label anchor included", () => {
    // A box is a virtual card: the same router, so a connector carries the same
    // routing payload a card's line does rather than a bare pair of handles.
    const nodes = [card("center", "Organization"), card("a1", "Application")];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    const d = edgeData(flow.edges[0]);
    expect(d.labelT).toBeTypeOf("number");
    expect(d.pathOffset).toBeTypeOf("number");
    expect(flow.edges[0].sourceHandle).toBeTruthy();
    expect(flow.edges[0].targetHandle).toBeTruthy();
  });

  it("renders only the handles its connectors actually use", () => {
    const nodes = [card("center", "Organization"), card("a1", "Application")];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    const box = clusters(flow.nodes)[0].data as LdvClusterData;
    expect(box.usedHandles?.length).toBeGreaterThan(0);
    expect(box.usedHandles).toContain(flow.edges[0].targetHandle);
  });

  it("drops the flow direction once several relation types share the line", () => {
    // It describes traffic along one relation type; with several merged the
    // arrowheads carry the direction instead.
    const nodes = [card("center", "Organization"), card("a1", "Application")];
    const edges: GEdge[] = [
      {
        source: "center",
        target: "a1",
        type: "relOrgToApp",
        label: "uses",
        attributes: { flowDirection: "reverse" },
      },
      {
        source: "center",
        target: "a1",
        type: "relOrgToAppOwns",
        label: "owns",
        attributes: { flowDirection: "reverse" },
      },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges).toHaveLength(1);
    expect(edgeData(flow.edges[0]).flowDirection).toBeUndefined();
  });

  it("collapses two rows of the same relation type between the same pair", () => {
    const nodes = [card("center", "Organization"), card("a1", "Application")];
    const edges: GEdge[] = [
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
      { source: "center", target: "a1", type: "relOrgToApp", label: "uses" },
    ];
    const flow = buildLdvAggregateFlow(nodes, edges, TYPES, "type", "center");
    expect(flow.edges).toHaveLength(1);
    expect(edgeData(flow.edges[0]).count).toBe(1);
  });
});
