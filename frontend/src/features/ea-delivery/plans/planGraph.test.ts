import { describe, it, expect } from "vitest";
import { buildPlanGraph, validatePlanOps } from "./planGraph";
import type { PlanBaseline, PlanChangeOp, RelationType } from "@/types";

const relType = (over: Partial<RelationType>): RelationType => ({
  key: "relAppToITC",
  label: "uses",
  reverse_label: "used by",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  cardinality: "n:m",
  attributes_schema: [],
  built_in: true,
  is_hidden: false,
  sort_order: 0,
  source_visible: true,
  source_mandatory: false,
  target_visible: true,
  target_mandatory: false,
  ...over,
});

const RELATION_TYPES: RelationType[] = [relType({})];

const baseline = (): PlanBaseline => ({
  nodes: [
    { id: "app-a", name: "Legacy CRM", type: "Application" },
    { id: "itc-1", name: "Postgres", type: "ITComponent" },
  ],
  edges: [{ source: "app-a", target: "itc-1", type: "relAppToITC", label: "uses" }],
});

const emptyLookup = new Map<string, { name: string; type: string }>();

describe("buildPlanGraph", () => {
  it("passes the baseline through untouched when there are no changes", () => {
    const g = buildPlanGraph(baseline(), [], RELATION_TYPES, emptyLookup);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.nodes.every((n) => n.changeState === undefined)).toBe(true);
    expect(g.edges[0].changeState).toBeUndefined();
  });

  it("does not mutate the baseline input", () => {
    const base = baseline();
    buildPlanGraph(base, [{ op: "remove_card", cardId: "app-a" }], RELATION_TYPES, emptyLookup);
    expect(base.nodes[0]).not.toHaveProperty("changeState");
    expect(base.edges[0]).not.toHaveProperty("changeState");
  });

  it("marks a removed card and its edges as removed", () => {
    const g = buildPlanGraph(
      baseline(),
      [{ op: "remove_card", cardId: "app-a" }],
      RELATION_TYPES,
      emptyLookup,
    );
    expect(g.nodes.find((n) => n.id === "app-a")?.changeState).toBe("removed");
    expect(g.edges[0].changeState).toBe("removed");
    expect(g.nodes.find((n) => n.id === "itc-1")?.changeState).toBeUndefined();
  });

  it("adds a proposed card as added + proposed", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "add_card",
        card: { proposed: { tempId: "tmp:x", name: "New Portal", cardTypeKey: "Application" } },
      },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    const node = g.nodes.find((n) => n.id === "tmp:x");
    expect(node?.changeState).toBe("added");
    expect(node?.proposed).toBe(true);
    expect(node?.type).toBe("Application");
  });

  it("adds an existing card via the lookup, not proposed", () => {
    const lookup = new Map([["card-9", { name: "Billing", type: "Application" }]]);
    const g = buildPlanGraph(
      baseline(),
      [{ op: "add_card", card: { existingCardId: "card-9" } }],
      RELATION_TYPES,
      lookup,
    );
    const node = g.nodes.find((n) => n.id === "card-9");
    expect(node?.changeState).toBe("added");
    expect(node?.proposed).toBe(false);
    expect(node?.name).toBe("Billing");
  });

  it("skips an existing add_card the lookup cannot resolve", () => {
    const g = buildPlanGraph(
      baseline(),
      [{ op: "add_card", card: { existingCardId: "ghost" } }],
      RELATION_TYPES,
      emptyLookup,
    );
    expect(g.nodes.find((n) => n.id === "ghost")).toBeUndefined();
  });

  it("replace marks predecessor removed, successor changed, and derives the swap edge", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "replace_card",
        predecessorId: "app-a",
        successor: { proposed: { tempId: "tmp:succ", name: "New CRM", cardTypeKey: "Application" } },
      },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    expect(g.nodes.find((n) => n.id === "app-a")?.changeState).toBe("removed");
    const successor = g.nodes.find((n) => n.id === "tmp:succ");
    expect(successor?.changeState).toBe("changed");
    expect(successor?.proposed).toBe(true);

    // Original edge kept as removed; derived edge on the successor is changed.
    const original = g.edges.find((e) => e.source === "app-a");
    expect(original?.changeState).toBe("removed");
    const derived = g.edges.find((e) => e.source === "tmp:succ");
    expect(derived?.changeState).toBe("changed");
    expect(derived?.target).toBe("itc-1");
    expect(derived?.type).toBe("relAppToITC");
  });

  it("replace honors a remove_relation op on the original edge", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "replace_card",
        predecessorId: "app-a",
        successor: { proposed: { tempId: "tmp:succ", name: "New CRM", cardTypeKey: "Application" } },
      },
      { op: "remove_relation", sourceId: "app-a", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    expect(g.edges.find((e) => e.source === "tmp:succ")).toBeUndefined();
    expect(g.edges.find((e) => e.source === "app-a")?.changeState).toBe("removed");
  });

  it("replace does not inherit edges onto a removed counterpart", () => {
    const changes: PlanChangeOp[] = [
      { op: "remove_card", cardId: "itc-1" },
      {
        op: "replace_card",
        predecessorId: "app-a",
        successor: { proposed: { tempId: "tmp:succ", name: "New CRM", cardTypeKey: "Application" } },
      },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    expect(g.edges.find((e) => e.source === "tmp:succ")).toBeUndefined();
  });

  it("add_relation enforces the metamodel direction", () => {
    // Declared backwards (ITComponent → Application); merge must flip it.
    const changes: PlanChangeOp[] = [
      { op: "add_relation", sourceId: "itc-1", targetId: "app-a", relationType: "relAppToITC" },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    const added = g.edges.find((e) => e.changeState === "added");
    expect(added?.source).toBe("app-a");
    expect(added?.target).toBe("itc-1");
    expect(added?.label).toBe("uses");
  });

  it("add_relation to a proposed card resolves the tempId endpoint", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "add_card",
        card: { proposed: { tempId: "tmp:x", name: "New Portal", cardTypeKey: "Application" } },
      },
      { op: "add_relation", sourceId: "tmp:x", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    const added = g.edges.find((e) => e.changeState === "added");
    expect(added?.source).toBe("tmp:x");
  });

  it("remove_relation marks the matching baseline edge removed", () => {
    const changes: PlanChangeOp[] = [
      { op: "remove_relation", sourceId: "app-a", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    const g = buildPlanGraph(baseline(), changes, RELATION_TYPES, emptyLookup);
    expect(g.edges[0].changeState).toBe("removed");
    expect(g.nodes.every((n) => n.changeState === undefined)).toBe(true);
  });
});

describe("validatePlanOps", () => {
  it("returns no errors for a consistent plan", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "replace_card",
        predecessorId: "app-a",
        successor: { proposed: { tempId: "tmp:s", name: "N", cardTypeKey: "Application" } },
      },
      { op: "add_relation", sourceId: "tmp:s", targetId: "itc-1", relationType: "relAppToITC" },
      { op: "remove_relation", sourceId: "app-a", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    expect(validatePlanOps(baseline(), changes)).toEqual([]);
  });

  it("flags ops whose targets vanished after a baseline refresh", () => {
    const changes: PlanChangeOp[] = [
      { op: "remove_card", cardId: "gone" },
      { op: "add_relation", sourceId: "gone", targetId: "itc-1", relationType: "relAppToITC" },
      { op: "remove_relation", sourceId: "gone", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    const errors = validatePlanOps(baseline(), changes);
    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatchObject({ index: 0, code: "missingCard" });
    expect(errors[1]).toMatchObject({ index: 1, code: "missingCard" });
    expect(errors[2]).toMatchObject({ index: 2, code: "missingEdge" });
  });

  it("accepts a remove_relation that targets a replace-derived edge", () => {
    const changes: PlanChangeOp[] = [
      {
        op: "replace_card",
        predecessorId: "app-a",
        successor: { proposed: { tempId: "tmp:s", name: "N", cardTypeKey: "Application" } },
      },
      { op: "remove_relation", sourceId: "tmp:s", targetId: "itc-1", relationType: "relAppToITC" },
    ];
    expect(validatePlanOps(baseline(), changes)).toEqual([]);
  });
});
