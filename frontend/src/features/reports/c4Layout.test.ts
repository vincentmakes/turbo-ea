import { describe, it, expect } from "vitest";
import { buildC4Flow, type GNode, type GEdge } from "./c4Layout";
import type { CardType } from "@/types";

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

describe("buildC4Flow", () => {
  it("returns empty output for empty input", () => {
    const result = buildC4Flow([], [], TYPES);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("creates group nodes for each category", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const result = buildC4Flow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "c4Group");
    expect(groups).toHaveLength(2);

    const groupLabels = groups.map((g) => (g.data as { label: string }).label);
    expect(groupLabels).toContain("Application & Data");
    expect(groupLabels).toContain("Technical Architecture");
  });

  it("creates c4Node nodes as children of groups", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "a2", name: "App 2", type: "Application" },
    ];
    const result = buildC4Flow(nodes, [], TYPES);

    const c4Nodes = result.nodes.filter((n) => n.type === "c4Node");
    expect(c4Nodes).toHaveLength(2);

    // Both should have the same parent group
    const parentIds = new Set(c4Nodes.map((n) => n.parentId));
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
    const result = buildC4Flow(nodes, edges, TYPES);

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
    const result = buildC4Flow(nodes, edges, TYPES);
    expect(result.edges).toHaveLength(0);
  });

  it("handles nodes with unknown category", () => {
    const unknownType = makeType({ key: "Custom", category: "Unknown Layer" });
    const nodes: GNode[] = [{ id: "c1", name: "Custom 1", type: "Custom" }];
    const result = buildC4Flow(nodes, [], [unknownType]);

    const groups = result.nodes.filter((n) => n.type === "c4Group");
    expect(groups).toHaveLength(1);
    expect((groups[0].data as { label: string }).label).toBe("Unknown Layer");
  });

  it("stacks groups vertically without overlap", () => {
    const nodes: GNode[] = [
      { id: "a1", name: "App 1", type: "Application" },
      { id: "a2", name: "App 2", type: "Application" },
      { id: "it1", name: "Server 1", type: "ITComponent" },
    ];
    const result = buildC4Flow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "c4Group");
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
    const result = buildC4Flow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "c4Group");
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

  it("orders categories according to standard C4 layer order", () => {
    const nodes: GNode[] = [
      { id: "it1", name: "Server 1", type: "ITComponent" },
      { id: "o1", name: "Org 1", type: "Organization" },
      { id: "a1", name: "App 1", type: "Application" },
    ];
    const result = buildC4Flow(nodes, [], TYPES);

    const groups = result.nodes.filter((n) => n.type === "c4Group");
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
