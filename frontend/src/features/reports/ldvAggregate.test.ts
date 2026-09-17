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
import { buildLdvAggregateFlow, type LdvAggregateBy, type LdvClusterData } from "./ldvAggregate";
import demo from "./__fixtures__/demoDependencies.json";
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
    // A node in its own right, not a child of anything.
    expect(centreNode.parentId).toBeUndefined();
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

  it("groups by layer into one box per layer", () => {
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

  it("places the boxes freely, with no layer lanes to pin them into rows", () => {
    // Pinning a box to the lane of its cards' layer fixes its row before
    // anything is known about what it connects to, so boxes that talk to each
    // other land at opposite ends and their connectors run the height of the
    // diagram and back. Freed, dagre puts connected boxes next to each other.
    const flow = buildLdvAggregateFlow(
      [card("a1", "Application"), card("i1", "ITComponent"), card("o1", "Organization")],
      [
        { source: "a1", target: "i1", type: "relAppToITC", label: "runs on" },
        { source: "o1", target: "a1", type: "relOrgToApp", label: "uses" },
      ],
      TYPES,
      "type",
    );
    expect(flow.nodes.some((n) => n.type === "ldvGroup")).toBe(false);
    for (const box of clusters(flow.nodes)) expect(box.parentId).toBeUndefined();
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

/**
 * The invariant, on the real demo landscape rather than a three-card fixture:
 * the depth-1 neighbourhood of SAP S/4HANA as the Dependencies report shows
 * it — 37 cards, 70 relations, every card type in play. Run at every level,
 * with and without a centred card, because each is a different partition of
 * the same relations and each has to satisfy the same rule.
 */
describe("one line per pair, on the demo landscape", () => {
  const nodes = demo.nodes as GNode[];
  const edges = demo.edges as GEdge[];
  const types = demo.types as unknown as CardType[];
  const centre = demo.centerId as string;
  const pairKey = (a: string, b: string) => (a < b ? `${a}||${b}` : `${b}||${a}`);

  // What the builder dedupes to before merging: one row per (pair, type).
  const dedupedRelations = new Set(
    edges.map((e) => `${pairKey(e.source, e.target)}||${e.type}`),
  ).size;

  const levels: Exclude<LdvAggregateBy, "none">[] = ["layer", "type", "subtype"];
  for (const level of levels) {
    for (const withCentre of [true, false]) {
      const label = `${level}${withCentre ? ", centred on SAP S/4HANA" : ", no centre"}`;

      it(`joins any two groups by at most ONE line (${label})`, () => {
        const flow = buildLdvAggregateFlow(nodes, edges, types, level, withCentre ? centre : undefined);
        const seen = new Map<string, string>();
        for (const e of flow.edges) {
          if (edgeData(e).count === undefined) continue;
          const key = pairKey(e.source, e.target);
          expect(
            seen.has(key) ? `${e.id} duplicates ${seen.get(key)} on ${key}` : "unique",
          ).toBe("unique");
          seen.set(key, e.id);
        }
        expect(seen.size).toBeGreaterThan(0);
      });

      it(`draws a line without a count only INSIDE one box (${label})`, () => {
        const flow = buildLdvAggregateFlow(nodes, edges, types, level, withCentre ? centre : undefined);
        for (const e of flow.edges) {
          if (edgeData(e).count !== undefined) continue;
          expect(flow.memberOf.get(e.source)).toBeDefined();
          expect(flow.memberOf.get(e.source)).toBe(flow.memberOf.get(e.target));
        }
      });

      it(`accounts for every relation exactly once (${label})`, () => {
        // Nothing drawn twice, nothing dropped: the counts on the connectors
        // plus the individual lines inside boxes add up to the relations.
        const flow = buildLdvAggregateFlow(nodes, edges, types, level, withCentre ? centre : undefined);
        let counted = 0;
        let inside = 0;
        for (const e of flow.edges) {
          const c = edgeData(e).count;
          if (c === undefined) inside++;
          else counted += c;
        }
        expect(counted + inside).toBe(dedupedRelations);
      });

      it(`never lets two connectors leave one node from the same point (${label})`, () => {
        // A handle is a point on the node's border; two connectors on the same
        // handle with the same stagger would coincide for their first stretch,
        // which is exactly what a duplicate line looks like.
        const flow = buildLdvAggregateFlow(nodes, edges, types, level, withCentre ? centre : undefined);
        const seen = new Set<string>();
        for (const e of flow.edges) {
          const d = edgeData(e);
          if (d.count === undefined) continue;
          for (const [node, handle] of [
            [e.source, e.sourceHandle],
            [e.target, e.targetHandle],
          ] as const) {
            const key = `${node}|${handle}|${d.pathOffset ?? 0}`;
            expect(seen.has(key) ? `two connectors share ${key}` : "distinct").toBe("distinct");
            seen.add(key);
          }
        }
      });
    }
  }

  it("gives the centred card one line per group it relates to, and no more", () => {
    const flow = buildLdvAggregateFlow(nodes, edges, types, "type", centre);
    const groups = new Map<string, number>();
    for (const e of flow.edges) {
      if (edgeData(e).count === undefined) continue;
      if (e.source !== centre && e.target !== centre) continue;
      const other = e.source === centre ? e.target : e.source;
      groups.set(other, (groups.get(other) ?? 0) + 1);
    }
    expect(groups.size).toBeGreaterThan(0);
    for (const [group, lines] of groups) {
      expect(`${group}: ${lines} line(s)`).toBe(`${group}: 1 line(s)`);
    }
  });

  it("splits the centred card's connectors over its top and bottom sides", () => {
    // Five handle slots per side. Ranking the groups that point INTO the
    // centre above it and the ones it points TO below it is what keeps its
    // ten connectors from all leaving one side and sharing slots.
    const flow = buildLdvAggregateFlow(nodes, edges, types, "type", centre);
    let top = 0;
    let bottom = 0;
    for (const e of flow.edges) {
      if (edgeData(e).count === undefined) continue;
      const h = e.source === centre ? e.sourceHandle : e.target === centre ? e.targetHandle : null;
      if (!h) continue;
      if (/^(t|ts)-/.test(h)) top++;
      else if (/^(b|bt)-/.test(h)) bottom++;
    }
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(Math.max(top, bottom)).toBeLessThanOrEqual(5);
  });
});
