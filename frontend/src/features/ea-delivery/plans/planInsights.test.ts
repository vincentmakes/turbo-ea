import { describe, it, expect } from "vitest";
import {
  affectedRealCardIds,
  computeCapabilityCoverage,
  computeCostDelta,
  computeGapBuckets,
  costFieldKeysByType,
  summarizeRisks,
} from "./planInsights";
import type { PlanGraph } from "./planGraph";
import type { CardType, PlanChangeOp } from "@/types";

const cardType = (key: string, costKey?: string): CardType =>
  ({
    key,
    label: key,
    icon: "x",
    color: "#000",
    has_hierarchy: false,
    has_successors: false,
    fields_schema: costKey
      ? [{ section: "Costs", fields: [{ key: costKey, label: "Cost", type: "cost" }] }]
      : [],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
  }) as unknown as CardType;

const TYPES: CardType[] = [
  cardType("Application", "costTotalAnnual"),
  cardType("BusinessCapability"),
];

describe("costFieldKeysByType", () => {
  it("collects cost fields per type", () => {
    const map = costFieldKeysByType(TYPES);
    expect(map.get("Application")).toEqual(["costTotalAnnual"]);
    expect(map.get("BusinessCapability")).toEqual([]);
  });
});

describe("computeGapBuckets", () => {
  it("buckets nodes and edges by changeState", () => {
    const graph: PlanGraph = {
      nodes: [
        { id: "r", name: "Retained", type: "Application" },
        { id: "a", name: "Added", type: "Application", changeState: "added" },
        { id: "x", name: "Removed", type: "Application", changeState: "removed" },
        { id: "c", name: "Changed", type: "Application", changeState: "changed" },
      ],
      edges: [
        { source: "r", target: "a", type: "t", changeState: "added" },
        { source: "r", target: "x", type: "t", changeState: "removed" },
      ],
    };
    const b = computeGapBuckets(graph);
    expect(b.retained.map((n) => n.id)).toEqual(["r"]);
    expect(b.added.map((n) => n.id)).toEqual(["a"]);
    expect(b.removed.map((n) => n.id)).toEqual(["x"]);
    expect(b.changed.map((n) => n.id)).toEqual(["c"]);
    expect(b.addedEdges).toBe(1);
    expect(b.removedEdges).toBe(1);
  });
});

describe("computeCostDelta", () => {
  it("computes before/after from attributes and proposed estimates", () => {
    const graph: PlanGraph = {
      nodes: [
        // retained: counts in both
        { id: "keep", name: "Keep", type: "Application", attributes: { costTotalAnnual: 100 } },
        // removed: counts only in before
        {
          id: "old",
          name: "Old",
          type: "Application",
          changeState: "removed",
          attributes: { costTotalAnnual: 500 },
        },
        // changed proposed successor with an estimate: only in after
        { id: "tmp:new", name: "New", type: "Application", changeState: "changed" },
      ],
      edges: [],
    };
    const changes: PlanChangeOp[] = [
      {
        op: "replace_card",
        predecessorId: "old",
        successor: {
          proposed: { tempId: "tmp:new", name: "New", cardTypeKey: "Application", estimatedCost: 200 },
        },
      },
    ];
    const d = computeCostDelta(graph, TYPES, changes);
    expect(d.before).toBe(600); // 100 + 500
    expect(d.after).toBe(300); // 100 + 200
    expect(d.delta).toBe(-300);
    expect(d.approximate).toBe(false);
  });

  it("flags approximate when a proposed card has no estimate", () => {
    const graph: PlanGraph = {
      nodes: [{ id: "tmp:new", name: "New", type: "Application", changeState: "added" }],
      edges: [],
    };
    const changes: PlanChangeOp[] = [
      { op: "add_card", card: { proposed: { tempId: "tmp:new", name: "New", cardTypeKey: "Application" } } },
    ];
    const d = computeCostDelta(graph, TYPES, changes);
    expect(d.approximate).toBe(true);
  });
});

describe("computeCapabilityCoverage", () => {
  const cap: PlanGraph["nodes"][number] = { id: "cap", name: "Billing", type: "BusinessCapability" };

  it("flags a capability that loses all supporting apps", () => {
    const graph: PlanGraph = {
      nodes: [
        cap,
        { id: "app", name: "App", type: "Application", changeState: "removed" },
      ],
      edges: [{ source: "app", target: "cap", type: "relAppToBC", changeState: "removed" }],
    };
    const gaps = computeCapabilityCoverage(graph);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].capabilityId).toBe("cap");
    expect(gaps[0].baselineApps).toBe(1);
  });

  it("does not flag when a replacement still supports the capability", () => {
    const graph: PlanGraph = {
      nodes: [
        cap,
        { id: "old", name: "Old", type: "Application", changeState: "removed" },
        { id: "tmp:new", name: "New", type: "Application", changeState: "changed" },
      ],
      edges: [
        { source: "old", target: "cap", type: "relAppToBC", changeState: "removed" },
        { source: "tmp:new", target: "cap", type: "relAppToBC", changeState: "changed" },
      ],
    };
    expect(computeCapabilityCoverage(graph)).toHaveLength(0);
  });

  it("does not flag a capability that had no support to begin with", () => {
    const graph: PlanGraph = { nodes: [cap], edges: [] };
    expect(computeCapabilityCoverage(graph)).toHaveLength(0);
  });
});

describe("summarizeRisks", () => {
  it("dedupes by id and counts high/critical by residual level", () => {
    const s = summarizeRisks([
      [
        { id: "1", residual_level: "high", initial_level: "critical" },
        { id: "2", residual_level: "low", initial_level: "high" },
      ],
      [
        { id: "1", residual_level: "high", initial_level: "critical" }, // dup
        { id: "3", residual_level: null, initial_level: "critical" }, // fallback to initial
      ],
    ]);
    expect(s.total).toBe(3);
    expect(s.high).toBe(2); // risk 1 (high) + risk 3 (critical via fallback)
  });
});

describe("affectedRealCardIds", () => {
  it("collects real ids from remove/replace/relation ops and skips tempIds", () => {
    const changes: PlanChangeOp[] = [
      { op: "remove_card", cardId: "c1" },
      {
        op: "replace_card",
        predecessorId: "c2",
        successor: { proposed: { tempId: "tmp:x", name: "X", cardTypeKey: "Application" } },
      },
      { op: "add_relation", sourceId: "tmp:x", targetId: "c3", relationType: "relAppToITC" },
    ];
    expect(affectedRealCardIds(changes).sort()).toEqual(["c1", "c2", "c3"]);
  });
});
