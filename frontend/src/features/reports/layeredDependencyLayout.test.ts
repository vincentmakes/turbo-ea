import { describe, it, expect } from "vitest";
import {
  buildLdvFlow,
  relationValueSuffix,
  filterEndOfLifeNodes,
  resolveRevealIds,
  stripEdgeLabels,
  type GNode,
  type GEdge,
} from "./layeredDependencyLayout";
import type { CardType, RelationType, FieldOption } from "@/types";

const PAST = "2000-01-01";
const FUTURE = "2999-01-01";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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
    subtypes: [],
    fields_schema: [],
    section_config: {},
    stakeholder_roles: [],
    translations: {},
  } as CardType;
}

const APP_TYPE = makeType({
  key: "Application",
  label: "Application",
  color: "#0f7eb5",
  category: "Application & Data",
  sort_order: 1,
});

const IT_TYPE = makeType({
  key: "ITComponent",
  label: "IT Component",
  color: "#d29270",
  category: "Technical Architecture",
  sort_order: 2,
});

const BIZ_TYPE = makeType({
  key: "Organization",
  label: "Organization",
  color: "#2889ff",
  category: "Business Architecture",
  sort_order: 3,
});

const TYPES = [APP_TYPE, IT_TYPE, BIZ_TYPE];

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("buildLdvFlow", () => {
  it("returns empty output for empty input", () => {
    const result = buildLdvFlow([], [], TYPES);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("creates group nodes for each category", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "ldvGroup");
    expect(groups).toHaveLength(2);

    const groupLabels = groups.map((g) => (g.data as { label: string }).label);
    expect(groupLabels).toContain("Application & Data");
    expect(groupLabels).toContain("Technical Architecture");
  });

  it("marks edges with a retired endpoint as severed, in either direction", () => {
    const nodes: GNode[] = [
      { id: "gone", name: "Gone", type: "Application", changeState: "retired" },
      { id: "stays", name: "Stays", type: "Application" },
      { id: "other", name: "Other", type: "Application" },
    ];
    const edges: GEdge[] = [
      { source: "gone", target: "stays", type: "uses" },
      { source: "stays", target: "other", type: "uses" },
    ];
    const result = buildLdvFlow(nodes, edges, TYPES);
    const severedFlags = result.edges.map((e) => (e.data as { severed?: boolean }).severed);
    expect(severedFlags).toContain(true);
    expect(severedFlags).toContain(false);
  });

  it("clears the verb the edge component actually renders", () => {
    // `data.relLabel` is what LdvEdgeComponent draws — NOT React Flow's own
    // `label` prop, which type-checks and does nothing. The hide-labels option
    // shipped inert on exactly that mistake, so this names the field.
    const nodes: GNode[] = [
      { id: "a", name: "A", type: "Application" },
      { id: "b", name: "B", type: "Application" },
    ];
    const built = buildLdvFlow(nodes, [{ source: "a", target: "b", type: "uses", label: "uses" }], TYPES);
    expect((built.edges[0].data as { relLabel: string }).relLabel).not.toBe("");

    const stripped = stripEdgeLabels(built.edges);
    expect((stripped[0].data as { relLabel: string }).relLabel).toBe("");
    // Everything else about the edge survives — routing, handles, direction —
    // so hiding the verbs cannot move an edge.
    expect({ ...stripped[0], data: null }).toEqual({ ...built.edges[0], data: null });
    const before = built.edges[0].data as Record<string, unknown>;
    const after = stripped[0].data as Record<string, unknown>;
    for (const k of Object.keys(before)) {
      if (k !== "relLabel") expect(after[k]).toEqual(before[k]);
    }
  });

  it("forwards the connection-change marks onto node data", () => {
    const nodes: GNode[] = [
      { id: "loses", name: "Loses", type: "Application", lostLink: true },
      { id: "gains", name: "Gains", type: "Application", gainedLink: true },
      { id: "fine", name: "Fine", type: "Application" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);
    const byId = new Map(
      result.nodes
        .filter((n) => n.type === "ldvNode")
        .map((n) => [n.id, n.data as { gainedLink?: boolean; lostLink?: boolean }]),
    );
    expect(byId.get("loses")?.lostLink).toBe(true);
    expect(byId.get("gains")?.gainedLink).toBe(true);
    expect(byId.get("fine")?.lostLink).toBeUndefined();
    expect(byId.get("fine")?.gainedLink).toBeUndefined();
  });

  it("forwards changeState and proposed onto node data", () => {
    const nodes: GNode[] = [
      { id: "new", name: "Arriving", type: "Application", changeState: "arriving" },
      { id: "old", name: "Retiring", type: "Application", changeState: "retired" },
      { id: "same", name: "Unchanged", type: "Application" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);
    const byId = new Map(
      result.nodes
        .filter((n) => n.type === "ldvNode")
        .map((n) => [n.id, n.data as { changeState?: string }]),
    );

    expect(byId.get("new")?.changeState).toBe("arriving");
    expect(byId.get("old")?.changeState).toBe("retired");
    expect(byId.get("same")?.changeState).toBeUndefined();
  });

  it("creates ldvNode nodes as children of groups", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "a2", name: "App 2", type: "Application" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);

    const ldvNodes = result.nodes.filter((n) => n.type === "ldvNode");
    expect(ldvNodes).toHaveLength(2);

    // Both should have the same parent group
    const parentIds = new Set(ldvNodes.map((n) => n.parentId));
    expect(parentIds.size).toBe(1);
    expect([...parentIds][0]).toMatch(/^group:/);
  });

  it("creates edges between nodes", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const edges: GEdge[] = [
      { source: "a1", target: "it1", type: "runs_on", label: "Runs On" },
    ];
    const result = buildLdvFlow(nodes, edges, TYPES);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe("a1");
    expect(result.edges[0].target).toBe("it1");
    expect(result.edges[0].label).toBe("Runs On");
  });

  it("skips edges referencing missing nodes", () => {
    const nodes: GNode[] = [{ id: "a1", name: "App 1", type: "Application" }];
    const edges: GEdge[] = [
      { source: "a1", target: "missing", type: "x", label: "X" },
    ];
    const result = buildLdvFlow(nodes, edges, TYPES);
    expect(result.edges).toHaveLength(0);
  });

  it("handles nodes with unknown category", () => {
    const unknownType = makeType({ key: "Custom", category: "Unknown Layer" });
    const nodes: GNode[] = [{ id: "c1", name: "Custom 1", type: "Custom" }];
    const result = buildLdvFlow(nodes, [], [unknownType]);

    const groups = result.nodes.filter((n) => n.type === "ldvGroup");
    expect(groups).toHaveLength(1);
    expect((groups[0].data as { label: string }).label).toBe("Unknown Layer");
  });

  it("stacks groups vertically without overlap", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "a2", name: "App 2", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "ldvGroup");
    expect(groups).toHaveLength(2);

    // Groups should not overlap vertically
    const [g1, g2] = groups.sort((a, b) => a.position.y - b.position.y);
    const g1Bottom = g1.position.y + ((g1.style as { height: number }).height || 0);
    expect(g2.position.y).toBeGreaterThan(g1Bottom);
  });

  it("centers groups horizontally when they differ in width", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "a2", name: "App 2", type: "Application" },
      { id: "a3", name: "App 3", type: "Application" },
      { id: "a4", name: "App 4", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "ldvGroup");
    expect(groups).toHaveLength(2);

    // The wider group (4 apps) should start at x=0 or close to 0
    // The narrower group (1 IT) should be offset to center
    const appGroup = groups.find(
      (g) => (g.data as { label: string }).label === "Application & Data",
    )!;
    const itGroup = groups.find(
      (g) => (g.data as { label: string }).label === "Technical Architecture",
    )!;

    const appW = (appGroup.style as { width: number }).width;
    const itW = (itGroup.style as { width: number }).width;

    if (appW > itW) {
      // Narrower group should be centered (x offset > 0)
      expect(itGroup.position.x).toBeGreaterThan(appGroup.position.x);
    }
  });

  describe("flowDirection on edges", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];

    it("renders markerEnd only when flowDirection=forward (or unset)", () => {
      const edges: GEdge[] = [
        {
          source: "a1",
          target: "it1",
          type: "runs_on",
          label: "Runs On",
          attributes: { flowDirection: "forward" },
        },
      ];
      const result = buildLdvFlow(nodes, edges, TYPES);
      expect(result.edges[0].markerEnd).toBeDefined();
      expect(result.edges[0].markerStart).toBeUndefined();
      // Direction is carried on edge data (rendered as a vector arrow), not
      // baked into the label string as a Unicode glyph (broke image export).
      expect(result.edges[0].label).toBe("Runs On");
      expect((result.edges[0].data as { flowDirection?: string }).flowDirection).toBe("forward");
    });

    it("renders markerStart only when flowDirection=reverse", () => {
      const edges: GEdge[] = [
        {
          source: "a1",
          target: "it1",
          type: "runs_on",
          label: "Runs On",
          attributes: { flowDirection: "reverse" },
        },
      ];
      const result = buildLdvFlow(nodes, edges, TYPES);
      expect(result.edges[0].markerEnd).toBeUndefined();
      expect(result.edges[0].markerStart).toBeDefined();
      expect(result.edges[0].label).toBe("Runs On");
      expect((result.edges[0].data as { flowDirection?: string }).flowDirection).toBe("reverse");
    });

    it("renders both markers when flowDirection=bidirectional", () => {
      const edges: GEdge[] = [
        {
          source: "a1",
          target: "it1",
          type: "runs_on",
          label: "Runs On",
          attributes: { flowDirection: "bidirectional" },
        },
      ];
      const result = buildLdvFlow(nodes, edges, TYPES);
      expect(result.edges[0].markerEnd).toBeDefined();
      expect(result.edges[0].markerStart).toBeDefined();
      expect(result.edges[0].label).toBe("Runs On");
      expect((result.edges[0].data as { flowDirection?: string }).flowDirection).toBe(
        "bidirectional",
      );
    });

    it("falls back to markerEnd only when attribute is absent", () => {
      const edges: GEdge[] = [
        { source: "a1", target: "it1", type: "runs_on", label: "Runs On" },
      ];
      const result = buildLdvFlow(nodes, edges, TYPES);
      expect(result.edges[0].markerEnd).toBeDefined();
      expect(result.edges[0].markerStart).toBeUndefined();
      expect(result.edges[0].label).toBe("Runs On");
    });
  });

  describe("relation value labels", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "o1", name: "Org 1", type: "Organization" },
    ];
    const edges: GEdge[] = [
      {
        source: "a1",
        target: "o1",
        type: "relAppToBC",
        label: "supports",
        reverse_label: "is supported by",
        attributes: { supportType: "leading" },
      },
    ];

    it("appends the resolver suffix to the edge label", () => {
      const result = buildLdvFlow(nodes, edges, TYPES, () => " [Leading]");
      expect(result.edges[0].label).toBe("supports [Leading]");
    });

    it("renders label-only when no resolver is provided", () => {
      const result = buildLdvFlow(nodes, edges, TYPES);
      expect(result.edges[0].label).toBe("supports");
    });

    it("renders label-only when the resolver returns undefined", () => {
      const result = buildLdvFlow(nodes, edges, TYPES, () => undefined);
      expect(result.edges[0].label).toBe("supports");
    });
  });

  it("orders categories according to the fixed EA layer order", () => {
    const nodes: GNode[] = [
      { id: "it1", name: "Server 1", type: "ITComponent" },
      { id: "o1", name: "Org 1", type: "Organization" },
      { id: "a1", name: "App 1", type: "Application" },
    ];
    const result = buildLdvFlow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "ldvGroup");
    const labels = groups.map((g) => (g.data as { label: string }).label);

    // Business Architecture should come before Application & Data,
    // which should come before Technical Architecture
    const bizIdx = labels.indexOf("Business Architecture");
    const appIdx = labels.indexOf("Application & Data");
    const techIdx = labels.indexOf("Technical Architecture");
    expect(bizIdx).toBeLessThan(appIdx);
    expect(appIdx).toBeLessThan(techIdx);
  });
});

describe("relationValueSuffix", () => {
  const makeRel = (schema: RelationType["attributes_schema"]): RelationType =>
    ({
      key: "relAppToBC",
      label: "supports",
      reverse_label: "is supported by",
      source_type_key: "Application",
      target_type_key: "BusinessCapability",
      cardinality: "n:m",
      attributes_schema: schema,
      built_in: true,
      is_hidden: false,
      sort_order: 0,
    }) as RelationType;

  const supportRel = makeRel([
    {
      key: "supportType",
      label: "Support Type",
      type: "single_select",
      options: [
        { key: "leading", label: "Leading" },
        { key: "supporting", label: "Supporting" },
      ],
    },
    {
      key: "flowDirection",
      label: "Flow direction",
      type: "single_select",
      options: [{ key: "forward", label: "Source → Target" }],
    },
  ]);
  const map = new Map([[supportRel.key, supportRel]]);
  const resolve = (o: FieldOption) => o.label;

  it("returns the single-select value as a bracket suffix", () => {
    const edge: GEdge = {
      source: "a",
      target: "b",
      type: "relAppToBC",
      attributes: { supportType: "leading" },
    };
    expect(relationValueSuffix(edge, map, resolve)).toBe(" [Leading]");
  });

  it("excludes flowDirection (shown as an arrow, not a bracket)", () => {
    const edge: GEdge = {
      source: "a",
      target: "b",
      type: "relAppToBC",
      attributes: { flowDirection: "forward" },
    };
    expect(relationValueSuffix(edge, map, resolve)).toBeUndefined();
  });

  it("returns undefined for no value, unknown type, or no attributes", () => {
    expect(
      relationValueSuffix(
        { source: "a", target: "b", type: "relAppToBC", attributes: {} },
        map,
        resolve,
      ),
    ).toBeUndefined();
    expect(
      relationValueSuffix(
        { source: "a", target: "b", type: "unknown", attributes: { supportType: "leading" } },
        map,
        resolve,
      ),
    ).toBeUndefined();
    expect(
      relationValueSuffix({ source: "a", target: "b", type: "relAppToBC" }, map, resolve),
    ).toBeUndefined();
  });

  it("joins multiple single-select values with a middot", () => {
    const multiRel = makeRel([
      {
        key: "usageType",
        label: "Usage Type",
        type: "single_select",
        options: [{ key: "owner", label: "Owner" }],
      },
      {
        key: "supportType",
        label: "Support Type",
        type: "single_select",
        options: [{ key: "leading", label: "Leading" }],
      },
    ]);
    const edge: GEdge = {
      source: "a",
      target: "b",
      type: "relAppToBC",
      attributes: { usageType: "owner", supportType: "leading" },
    };
    expect(relationValueSuffix(edge, new Map([[multiRel.key, multiRel]]), resolve)).toBe(
      " [Owner · Leading]",
    );
  });
});

describe("filterEndOfLifeNodes", () => {
  it("drops an end-of-life node and its now-dangling edge", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application", lifecycle: { active: PAST } },
      { id: "eol", name: "Old App", type: "Application", lifecycle: { endOfLife: PAST } },
    ];
    const edges: GEdge[] = [{ source: "a1", target: "eol", type: "uses" }];
    const result = filterEndOfLifeNodes(nodes, edges);

    expect(result.nodes.map((n) => n.id)).toEqual(["a1"]);
    expect(result.edges).toHaveLength(0);
  });

  it("keeps an end-of-life node when it is the centered card", () => {
    const nodes: GNode[] = [
      { id: "center", name: "Focus", type: "Application", lifecycle: { endOfLife: PAST } },
      { id: "a1", name: "App 1", type: "Application", lifecycle: { active: PAST } },
    ];
    const edges: GEdge[] = [{ source: "center", target: "a1", type: "uses" }];
    const result = filterEndOfLifeNodes(nodes, edges, "center");

    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a1", "center"]);
    expect(result.edges).toHaveLength(1);
  });

  it("keeps an end-of-life node when it is proposed (NEW)", () => {
    const nodes: GNode[] = [
      { id: "new", name: "Proposed", type: "Application", lifecycle: { endOfLife: PAST }, proposed: true },
    ];
    const result = filterEndOfLifeNodes(nodes, []);
    expect(result.nodes.map((n) => n.id)).toEqual(["new"]);
  });

  it("keeps non-end-of-life nodes and edges between survivors", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application", lifecycle: { active: PAST } },
      { id: "a2", name: "App 2", type: "Application", lifecycle: { endOfLife: FUTURE } },
      { id: "a3", name: "App 3", type: "Application" },
    ];
    const edges: GEdge[] = [
      { source: "a1", target: "a2", type: "uses" },
      { source: "a2", target: "a3", type: "uses" },
    ];
    const result = filterEndOfLifeNodes(nodes, edges);

    // a2's endOfLife date is in the future, so it is not yet end-of-life.
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["a1", "a2", "a3"]);
    expect(result.edges).toHaveLength(2);
  });

  it("judges end of life against asOfMs when time-travelling", () => {
    const nodes: GNode[] = [
      { id: "later", name: "Retires later", type: "Application", lifecycle: { endOfLife: FUTURE } },
    ];
    // Viewed from beyond its end-of-life date it is gone...
    const beyond = new Date(FUTURE).getTime() + 86_400_000;
    expect(filterEndOfLifeNodes(nodes, [], undefined, beyond).nodes).toHaveLength(0);
    // ...but from today it is still very much alive.
    expect(filterEndOfLifeNodes(nodes, [], undefined, Date.now()).nodes).toHaveLength(1);
  });

  it("keeps a node the consumer marked as retired at the date it is showing", () => {
    // A card retiring inside a time-travel window IS end-of-life at the viewed
    // date — dropping it would delete exactly what the view exists to show.
    const nodes: GNode[] = [
      {
        id: "going",
        name: "On its way out",
        type: "Application",
        lifecycle: { active: "2000-01-01", endOfLife: PAST },
        changeState: "retired",
      },
    ];
    expect(filterEndOfLifeNodes(nodes, []).nodes.map((n) => n.id)).toEqual(["going"]);
    const beyond = new Date(PAST).getTime() + 86_400_000;
    expect(filterEndOfLifeNodes(nodes, [], undefined, beyond).nodes.map((n) => n.id)).toEqual([
      "going",
    ]);
  });

  it("keeps a node that is end-of-life today but was alive at a past date", () => {
    const nodes: GNode[] = [
      { id: "gone", name: "Retired", type: "Application", lifecycle: { active: "2000-01-01", endOfLife: PAST } },
    ];
    expect(filterEndOfLifeNodes(nodes, []).nodes).toHaveLength(0);
    const before = new Date(PAST).getTime() - 86_400_000;
    expect(filterEndOfLifeNodes(nodes, [], undefined, before).nodes.map((n) => n.id)).toEqual([
      "gone",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  resolveRevealIds (Reveal parent / Reveal children toolbar tools)   */
/* ------------------------------------------------------------------ */

describe("resolveRevealIds", () => {
  const nodes: GNode[] = [
    { id: "root", name: "Root", type: "Organization", parent_id: null },
    { id: "mid", name: "Mid", type: "Organization", parent_id: "root" },
    { id: "leafA", name: "Leaf A", type: "Application", parent_id: "mid" },
    { id: "leafB", name: "Leaf B", type: "Application", parent_id: "mid" },
  ];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  it("reveals the single hierarchical parent", () => {
    expect(resolveRevealIds(nodes, nodeMap, "mid", "parents")).toEqual(["root"]);
    expect(resolveRevealIds(nodes, nodeMap, "leafA", "parents")).toEqual(["mid"]);
  });

  it("returns nothing for a root card in parents mode", () => {
    expect(resolveRevealIds(nodes, nodeMap, "root", "parents")).toEqual([]);
  });

  it("returns nothing when the parent is outside the loaded graph", () => {
    const orphan: GNode[] = [{ id: "x", name: "X", type: "Application", parent_id: "missing" }];
    expect(resolveRevealIds(orphan, new Map([["x", orphan[0]]]), "x", "parents")).toEqual([]);
  });

  it("reveals all direct children", () => {
    expect(resolveRevealIds(nodes, nodeMap, "mid", "children").sort()).toEqual(["leafA", "leafB"]);
    expect(resolveRevealIds(nodes, nodeMap, "root", "children")).toEqual(["mid"]);
  });

  it("returns nothing for a leaf card in children mode", () => {
    expect(resolveRevealIds(nodes, nodeMap, "leafA", "children")).toEqual([]);
  });
});
