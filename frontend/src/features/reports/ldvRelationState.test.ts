/**
 * A relation not in effect at the viewed date by its own dates is drawn in its
 * own state in the Layered Dependency View: stamped from its lifecycle, carried
 * through both layouts into the edge data, and coloured by `edgeColors`.
 */
import { describe, it, expect } from "vitest";
import { buildLdvFlow, type GEdge, type GNode, type LdvEdgeData } from "./layeredDependencyLayout";
import { buildLdvAggregateFlow, connectorRelationState } from "./ldvAggregate";
import { withRelationStates } from "./ldvLayoutShared";
import { edgeColors } from "./ldvViewModel";
import { SCREEN_INK, STATUS_COLORS, TIMELINE_COLORS, brand } from "@/theme/tokens";
import type { CardType } from "@/types";

const ms = (iso: string) => new Date(iso).getTime();
const AT = ms("2027-06-01");

const e = (target: string, lifecycle?: Record<string, string>, extra: Partial<GEdge> = {}) =>
  ({ source: "a", target, type: "rel", ...(lifecycle ? { lifecycle } : {}), ...extra }) as GEdge;

describe("withRelationStates", () => {
  it("stamps planned and ended, and leaves in-effect and undated edges as they came", () => {
    const undated = e("b");
    const current = e("c", { active: "2027-06-01" });
    const planned = e("d", { active: "2027-06-02" });
    const ended = e("f", { endOfLife: "2027-06-01" });
    const out = withRelationStates([undated, current, planned, ended], AT);
    expect(out[0]).toBe(undated);
    expect(out[1]).toBe(current);
    expect(out[2].relationState).toBe("planned");
    expect(out[3].relationState).toBe("ended");
    // Never mutates the edges it was given.
    expect(planned.relationState).toBeUndefined();
  });

  it("keeps a state the consumer set at its own date", () => {
    const set = e("b", { active: "2020-01-01" }, { relationState: "ended" });
    expect(withRelationStates([set], AT)[0]).toBe(set);
  });
});

describe("connectorRelationState", () => {
  it("takes the state only when every merged relation shares it", () => {
    expect(connectorRelationState(new Set(["planned"] as const))).toEqual({
      relationState: "planned",
    });
    expect(connectorRelationState(new Set(["ended"] as const))).toEqual({
      relationState: "ended",
    });
    expect(connectorRelationState(new Set(["planned", "ended"] as const))).toEqual({});
    expect(connectorRelationState(new Set(["planned", undefined] as const))).toEqual({});
    expect(connectorRelationState(new Set([undefined]))).toEqual({});
  });
});

describe("the layouts carry the state into the edge data", () => {
  const types = [
    { key: "Application", label: "Application", color: "#000000", icon: "apps", category: "Application & Data" },
  ] as unknown as CardType[];
  const nodes: GNode[] = ["a", "b", "c"].map((id) => ({ id, name: id, type: "Application" }));
  const edges: GEdge[] = [
    e("b", undefined, { relationState: "planned" }),
    e("c"),
  ];

  it("plain layout", () => {
    const flow = buildLdvFlow(nodes, edges, types);
    const byTarget = new Map(flow.edges.map((x) => [x.target, x.data as LdvEdgeData]));
    expect(byTarget.get("b")?.relationState).toBe("planned");
    expect(byTarget.get("c")).toBeDefined();
    expect("relationState" in (byTarget.get("c") as object)).toBe(false);
  });

  it("aggregate layout, inside one box", () => {
    const flow = buildLdvAggregateFlow(nodes, edges, types, "type");
    const states = flow.edges
      .map((x) => (x.data as LdvEdgeData).relationState)
      .filter(Boolean);
    expect(states).toEqual(["planned"]);
  });
});

describe("edgeColors for a relation's own state", () => {
  it("draws planned in the future violet and ended in neutral grey, lit or not", () => {
    for (const active of [false, true]) {
      expect(edgeColors(active, false, false, "planned").stroke).toBe(TIMELINE_COLORS.future);
      expect(edgeColors(active, false, true, "ended").stroke).toBe(STATUS_COLORS.neutral);
    }
  });

  it("lets severed win over the relation's state", () => {
    expect(edgeColors(false, true, false, "planned").stroke).toBe(STATUS_COLORS.error);
    expect(edgeColors(true, true, false, "ended").stroke).toBe(STATUS_COLORS.error);
  });

  it("is unchanged without a state", () => {
    expect(edgeColors(false, false, false).stroke).toBe(SCREEN_INK.secondary);
    expect(edgeColors(true, false, false).stroke).toBe(brand.primary);
    expect(edgeColors(false, false, true).stroke).toBe(STATUS_COLORS.neutral);
  });
});
