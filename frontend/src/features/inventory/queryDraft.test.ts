import { describe, expect, it } from "vitest";
import { makeRelationType, makeTag, makeTagGroup } from "@/test/fixtures/metamodel";
import type { CardQuery } from "@/types";
import {
  MAX_CHAIN_DEPTH,
  appendHop,
  chainNodes,
  conditionValues,
  draftProblem,
  facetToLifecycle,
  lifecycleToFacet,
  rebuildChain,
  relationChoices,
  removeCondition,
  removeHopAt,
  setCondition,
  setStartType,
  tagChipsByGroup,
  toggleNegate,
} from "./queryDraft";

const CHAIN: CardQuery = {
  type: "Organization",
  where: { approval_status: ["APPROVED"] },
  related: [
    {
      relation: "relOrgToApp",
      type: "Application",
      where: { lifecycle_phase: ["active"] },
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    },
  ],
};

/** A branch beside the chain (as an MCP assistant may write it). */
const BRANCHED: CardQuery = {
  type: "Organization",
  related: [
    { relation: "relOrgToApp", type: "Application" },
    { relation: "relOrgToBC", type: "BusinessCapability", negate: true },
  ],
};

describe("chainNodes / rebuildChain", () => {
  it("reads the first hop of each level as the chain", () => {
    expect(chainNodes(CHAIN)).toEqual([
      { type: "Organization", where: { approval_status: ["APPROVED"] } },
      { relation: "relOrgToApp", type: "Application", where: { lifecycle_phase: ["active"] } },
      { relation: "relInitiativeToApp", type: "Initiative", negate: true },
    ]);
  });

  it("keeps hops beside the chain on the node they hang from", () => {
    expect(chainNodes(BRANCHED)).toEqual([
      {
        type: "Organization",
        extra: [{ relation: "relOrgToBC", type: "BusinessCapability", negate: true }],
      },
      { relation: "relOrgToApp", type: "Application" },
    ]);
  });

  it("round-trips a chain and a branched query exactly", () => {
    expect(rebuildChain(chainNodes(CHAIN))).toEqual(CHAIN);
    expect(rebuildChain(chainNodes(BRANCHED))).toEqual(BRANCHED);
    expect(rebuildChain(chainNodes({ type: "Application" }))).toEqual({ type: "Application" });
  });

  it("writes a bare start node and an empty list as nothing", () => {
    expect(rebuildChain([])).toEqual({ type: "" });
    expect(rebuildChain([{ type: "A" }, { relation: "r", type: "B", negate: false }])).toEqual({
      type: "A",
      related: [{ relation: "r", type: "B" }],
    });
  });
});

describe("setStartType", () => {
  it("resets the chain on a new type and keeps the query on the same one", () => {
    expect(setStartType(CHAIN, "Application")).toEqual({ type: "Application" });
    expect(setStartType(CHAIN, "Organization")).toBe(CHAIN);
  });
});

describe("appendHop / removeHopAt / toggleNegate", () => {
  it("appends a hop after the last node", () => {
    expect(appendHop({ type: "Organization" }, "relOrgToApp", "Application")).toEqual({
      type: "Organization",
      related: [{ relation: "relOrgToApp", type: "Application" }],
    });
    expect(appendHop(CHAIN, "relX", "Objective").related![0].related![0].related).toEqual([
      { relation: "relX", type: "Objective" },
    ]);
  });

  it("stops at MAX_CHAIN_DEPTH hops", () => {
    expect(MAX_CHAIN_DEPTH).toBe(3);
    const three = appendHop(CHAIN, "relX", "Objective");
    expect(chainNodes(three)).toHaveLength(4);
    expect(appendHop(three, "relY", "Platform")).toBe(three);
  });

  it("removes a hop and everything after it", () => {
    expect(removeHopAt(CHAIN, 1)).toEqual({
      type: "Organization",
      where: { approval_status: ["APPROVED"] },
    });
    expect(removeHopAt(CHAIN, 2)).toEqual({
      type: "Organization",
      where: { approval_status: ["APPROVED"] },
      related: [
        { relation: "relOrgToApp", type: "Application", where: { lifecycle_phase: ["active"] } },
      ],
    });
  });

  it("never removes the start node or a hop that is not there", () => {
    expect(removeHopAt(CHAIN, 0)).toBe(CHAIN);
    expect(removeHopAt(CHAIN, 3)).toBe(CHAIN);
  });

  it("flips has / has no on a hop, never on the start", () => {
    const on = toggleNegate(CHAIN, 1);
    expect(on.related![0]).toEqual({
      relation: "relOrgToApp",
      type: "Application",
      where: { lifecycle_phase: ["active"] },
      negate: true,
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    });
    expect(toggleNegate(CHAIN, 2).related![0].related).toEqual([
      { relation: "relInitiativeToApp", type: "Initiative" },
    ]);
    expect(toggleNegate(CHAIN, 0)).toBe(CHAIN);
    expect(toggleNegate(CHAIN, 7)).toBe(CHAIN);
  });
});

describe("setCondition / removeCondition / conditionValues", () => {
  it("sets each kind of condition on the node it names", () => {
    const q = { type: "Application" };
    expect(setCondition(q, 0, "lifecycle_phase", ["active"])).toEqual({
      type: "Application",
      where: { lifecycle_phase: ["active"] },
    });
    expect(setCondition(q, 0, "subtype", ["bizApp"]).where).toEqual({ subtype: ["bizApp"] });
    expect(setCondition(q, 0, "approval_status", ["DRAFT"]).where).toEqual({
      approval_status: ["DRAFT"],
    });
    expect(setCondition(q, 0, "tags", ["t1"]).where).toEqual({ tags: ["t1"] });
    expect(setCondition(q, 0, { attribute: "criticality" }, ["high"]).where).toEqual({
      attributes: { criticality: ["high"] },
    });
    expect(setCondition(CHAIN, 2, "subtype", ["proj"]).related![0].related![0]).toEqual({
      relation: "relInitiativeToApp",
      type: "Initiative",
      negate: true,
      where: { subtype: ["proj"] },
    });
  });

  it("keeps an empty list as a condition still being filled in", () => {
    expect(setCondition({ type: "A" }, 0, "lifecycle_phase", [])).toEqual({
      type: "A",
      where: { lifecycle_phase: [] },
    });
  });

  it("does not share the caller's array", () => {
    const values = ["active"];
    const q = setCondition({ type: "A" }, 0, "lifecycle_phase", values);
    values.push("plan");
    expect(q.where).toEqual({ lifecycle_phase: ["active"] });
  });

  it("removes a condition and drops an emptied attributes map and where", () => {
    const q: CardQuery = {
      type: "A",
      where: { lifecycle_phase: ["active"], attributes: { a: ["x"], b: ["y"] } },
    };
    expect(removeCondition(q, 0, { attribute: "a" })).toEqual({
      type: "A",
      where: { lifecycle_phase: ["active"], attributes: { b: ["y"] } },
    });
    const noAttrs = removeCondition(removeCondition(q, 0, { attribute: "a" }), 0, { attribute: "b" });
    expect(noAttrs).toEqual({ type: "A", where: { lifecycle_phase: ["active"] } });
    expect(removeCondition(noAttrs, 0, "lifecycle_phase")).toEqual({ type: "A" });
    expect(removeCondition(CHAIN, 1, "lifecycle_phase").related![0]).toEqual({
      relation: "relOrgToApp",
      type: "Application",
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    });
  });

  it("ignores a node that is not in the chain", () => {
    expect(setCondition(CHAIN, 5, "subtype", ["x"])).toBe(CHAIN);
    expect(setCondition(CHAIN, -1, "subtype", ["x"])).toBe(CHAIN);
  });

  it("reads a condition's values", () => {
    const where = { tags: ["t1"], attributes: { a: ["x"] } };
    expect(conditionValues(where, "tags")).toEqual(["t1"]);
    expect(conditionValues(where, { attribute: "a" })).toEqual(["x"]);
    expect(conditionValues(where, { attribute: "b" })).toBeUndefined();
    expect(conditionValues(where, "subtype")).toBeUndefined();
    expect(conditionValues(undefined, "tags")).toBeUndefined();
  });
});

describe("lifecycle mapping", () => {
  it("maps the grammar's none to the facet's empty key and back", () => {
    expect(lifecycleToFacet(["active", "none"])).toEqual(["active", "__empty__"]);
    expect(facetToLifecycle(["__empty__", "plan"])).toEqual(["none", "plan"]);
  });
});

describe("draftProblem", () => {
  it("names a missing type, then a condition without values, anywhere in the tree", () => {
    expect(draftProblem({ type: "" })).toBe("empty_type");
    expect(draftProblem({ type: "", where: { subtype: [] } })).toBe("empty_type");
    expect(draftProblem({ type: "A", where: { subtype: [] } })).toBe("empty_values");
    expect(draftProblem({ type: "A", where: { tags: [] } })).toBe("empty_values");
    expect(draftProblem({ type: "A", where: { attributes: { f: [] } } })).toBe("empty_values");
    expect(
      draftProblem({
        type: "A",
        related: [{ relation: "r", type: "B", related: [{ relation: "s", type: "C", where: { approval_status: [] } }] }],
      }),
    ).toBe("empty_values");
    expect(draftProblem({ type: "A", related: [{ relation: "r", type: "" }] })).toBe("empty_values");
    expect(draftProblem(CHAIN)).toBeNull();
    expect(draftProblem(BRANCHED)).toBeNull();
  });
});

describe("relationChoices", () => {
  const ORG_APP = makeRelationType({
    key: "relOrgToApp",
    source_type_key: "Organization",
    target_type_key: "Application",
  });
  const APP_APP = makeRelationType({
    key: "relAppToApp",
    source_type_key: "Application",
    target_type_key: "Application",
  });
  const ITC = makeRelationType({
    key: "relItc",
    source_type_key: "ITComponent",
    target_type_key: "Platform",
  });

  it("offers each side the type takes part in, both sides of a self-reference", () => {
    const choices = relationChoices("Application", [ORG_APP, APP_APP, ITC]);
    expect(choices.map(({ rt: _rt, ...c }) => c)).toEqual([
      { key: "relOrgToApp", isSource: false, otherType: "Organization" },
      { key: "relAppToApp__out", isSource: true, otherType: "Application" },
      { key: "relAppToApp__in", isSource: false, otherType: "Application" },
    ]);
    expect(choices.map((c) => c.rt)).toEqual([ORG_APP, APP_APP, APP_APP]);
    expect(relationChoices("Organization", [ORG_APP])).toEqual([
      { key: "relOrgToApp", rt: ORG_APP, isSource: true, otherType: "Application" },
    ]);
  });
});

describe("tagChipsByGroup", () => {
  const domain = makeTagGroup({ name: "Domain" });
  const finance = makeTag({ name: "Finance", tag_group_id: domain.id });
  const sales = makeTag({ name: "Sales", tag_group_id: domain.id });
  domain.tags = [finance, sales];
  const tier = makeTagGroup({ name: "Tier", restrict_to_types: ["Application"] });
  const gold = makeTag({ name: "Gold", tag_group_id: tier.id });
  tier.tags = [gold];

  it("gives one chip per group in first-named order, unknown ids last", () => {
    expect(tagChipsByGroup([gold.id, finance.id, "gone", sales.id], [domain, tier], "(unknown tag)")).toEqual([
      { key: tier.id, label: "Tier: Gold", ids: [gold.id] },
      { key: domain.id, label: "Domain: Finance, Sales", ids: [finance.id, sales.id] },
      { key: "__unknown__", label: "(unknown tag)", ids: ["gone"] },
    ]);
    expect(tagChipsByGroup([], [domain], "x")).toEqual([]);
  });
});
