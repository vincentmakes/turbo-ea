import { describe, it, expect } from "vitest";
import {
  buildLdvFlow,
  filterEndOfLifeNodes,
  type GNode,
  type GEdge,
} from "./layeredDependencyLayout";
import type { CardType } from "@/types";

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
      expect(result.edges[0].label).toBe("→ Runs On");
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
      expect(result.edges[0].label).toBe("← Runs On");
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
      expect(result.edges[0].label).toBe("↔ Runs On");
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
});
