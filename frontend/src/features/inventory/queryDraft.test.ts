import { describe, expect, it } from "vitest";
import { makeRelationType, makeTag, makeTagGroup } from "@/test/fixtures/metamodel";
import type { CardQuery, CardQueryHop } from "@/types";
import type { CardNameEntry } from "./useCardNames";
import {
  MAX_CHAIN_DEPTH,
  MAX_HOPS_PER_LIST,
  MAX_HOPS_TOTAL,
  addBranch,
  appendHopAt,
  canAppend,
  canBranch,
  cardNameLabel,
  cardsChipLabel,
  conditionValues,
  draftProblem,
  facetToLifecycle,
  hopCount,
  lifecycleToFacet,
  nodeAt,
  normalizeHops,
  pickedCardIds,
  relationChoices,
  removeCondition,
  removeHopAt,
  rows,
  sendableQuery,
  setCondition,
  setIncludeDescendants,
  setStartType,
  tagChipsByGroup,
  toggleNegate,
  type NodePath,
} from "./queryDraft";

/** Steps down the tree: the `i`-th hop of `related` (R) or of `related_any` (O). */
const R = (index = 0) => ({ list: "related" as const, index });
const O = (index = 0) => ({ list: "related_any" as const, index });
const P1: NodePath = [R()];
const P2: NodePath = [R(), R()];

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

/** An OR group under the start card: either relation will do. */
const OR_QUERY: CardQuery = {
  type: "Organization",
  related_any: [
    { relation: "relOrgToApp", type: "Application" },
    { relation: "relOrgToBC", type: "BusinessCapability" },
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

describe("nodeAt", () => {
  it("follows a path through both lists, undefined past the tree", () => {
    expect(nodeAt(CHAIN, [])).toBe(CHAIN);
    expect(nodeAt(CHAIN, P1)).toBe(CHAIN.related![0]);
    expect(nodeAt(CHAIN, P2)).toEqual({
      relation: "relInitiativeToApp",
      type: "Initiative",
      negate: true,
    });
    expect(nodeAt(OR_QUERY, [O(1)])).toEqual({ relation: "relOrgToBC", type: "BusinessCapability" });
    expect(nodeAt(CHAIN, [R(1)])).toBeUndefined();
    expect(nodeAt(CHAIN, [O()])).toBeUndefined();
    expect(nodeAt(CHAIN, [R(), R(), R()])).toBeUndefined();
  });
});

describe("rows", () => {
  it("reads a linear chain as one row", () => {
    expect(rows(CHAIN)).toEqual([
      {
        depth: 0,
        parentPath: null,
        connective: null,
        nodes: [
          { path: [], hop: null },
          { path: P1, hop: CHAIN.related![0] },
          { path: P2, hop: CHAIN.related![0].related![0] },
        ],
      },
    ]);
    expect(rows({ type: "" })).toEqual([
      { depth: 0, parentPath: null, connective: null, nodes: [{ path: [], hop: null }] },
    ]);
  });

  it("opens an and row under the start card for A and B", () => {
    expect(rows(BRANCHED)).toEqual([
      {
        depth: 0,
        parentPath: null,
        connective: null,
        nodes: [
          { path: [], hop: null },
          { path: [R(0)], hop: { relation: "relOrgToApp", type: "Application" } },
        ],
      },
      {
        depth: 1,
        parentPath: [],
        connective: "and",
        nodes: [
          {
            path: [R(1)],
            hop: { relation: "relOrgToBC", type: "BusinessCapability", negate: true },
          },
        ],
      },
    ]);
  });

  it("continues with the first OR hop and opens an or row for the second", () => {
    expect(rows(OR_QUERY)).toEqual([
      {
        depth: 0,
        parentPath: null,
        connective: null,
        nodes: [
          { path: [], hop: null },
          { path: [O(0)], hop: { relation: "relOrgToApp", type: "Application" } },
        ],
      },
      {
        depth: 1,
        parentPath: [],
        connective: "or",
        nodes: [{ path: [O(1)], hop: { relation: "relOrgToBC", type: "BusinessCapability" } }],
      },
    ]);
  });

  it("lists or rows before and rows, every AND hop opening a row beside an OR group", () => {
    const q: CardQuery = {
      type: "A",
      related: [{ relation: "a", type: "X" }],
      related_any: [
        { relation: "b", type: "Y" },
        { relation: "c", type: "Z" },
      ],
    };
    expect(rows(q).map((r) => [r.connective, r.nodes.map((n) => n.hop?.type ?? "start")])).toEqual([
      [null, ["start", "Y"]],
      ["or", ["Z"]],
      ["and", ["X"]],
    ]);
  });

  it("anchors a branch two levels down at depth 2, its own chain on its row", () => {
    const q: CardQuery = {
      type: "Organization",
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          related: [
            { relation: "relInitiativeToApp", type: "Initiative" },
            {
              relation: "relAppToITC",
              type: "ITComponent",
              related: [{ relation: "relItc", type: "Platform" }],
            },
          ],
        },
        { relation: "relOrgToBC", type: "BusinessCapability" },
      ],
    };
    expect(
      rows(q).map(({ depth, parentPath, connective, nodes }) => ({
        depth,
        parentPath,
        connective,
        paths: nodes.map((n) => n.path),
      })),
    ).toEqual([
      { depth: 0, parentPath: null, connective: null, paths: [[], [R()], [R(), R()]] },
      // The last node's branches come first, so a row sits right below its parent.
      {
        depth: 2,
        parentPath: [R()],
        connective: "and",
        paths: [
          [R(), R(1)],
          [R(), R(1), R()],
        ],
      },
      { depth: 1, parentPath: [], connective: "and", paths: [[R(1)]] },
    ]);
  });
});

describe("setStartType", () => {
  it("resets the chain on a new type and keeps the query on the same one", () => {
    expect(setStartType(CHAIN, "Application")).toEqual({ type: "Application" });
    expect(setStartType(CHAIN, "Organization")).toBe(CHAIN);
  });
});

describe("appendHopAt / removeHopAt / toggleNegate", () => {
  it("appends a hop to the node's related list", () => {
    expect(appendHopAt({ type: "Organization" }, [], "relOrgToApp", "Application")).toEqual({
      type: "Organization",
      related: [{ relation: "relOrgToApp", type: "Application" }],
    });
    expect(appendHopAt(CHAIN, P2, "relX", "Objective").related![0].related![0].related).toEqual([
      { relation: "relX", type: "Objective" },
    ]);
    expect(appendHopAt(CHAIN, [R(4)], "relX", "Objective")).toBe(CHAIN);
  });

  it("stops at MAX_CHAIN_DEPTH hops", () => {
    expect(MAX_CHAIN_DEPTH).toBe(3);
    const three = appendHopAt(CHAIN, P2, "relX", "Objective");
    expect(nodeAt(three, [R(), R(), R()])).toEqual({ relation: "relX", type: "Objective" });
    expect(appendHopAt(three, [R(), R(), R()], "relY", "Platform")).toBe(three);
  });

  it("removes a hop and everything after it", () => {
    expect(removeHopAt(CHAIN, P1)).toEqual({
      type: "Organization",
      where: { approval_status: ["APPROVED"] },
    });
    expect(removeHopAt(CHAIN, P2)).toEqual({
      type: "Organization",
      where: { approval_status: ["APPROVED"] },
      related: [
        { relation: "relOrgToApp", type: "Application", where: { lifecycle_phase: ["active"] } },
      ],
    });
    expect(removeHopAt(BRANCHED, [R(0)])).toEqual({
      type: "Organization",
      related: [{ relation: "relOrgToBC", type: "BusinessCapability", negate: true }],
    });
  });

  it("never removes the start node or a hop that is not there", () => {
    expect(removeHopAt(CHAIN, [])).toBe(CHAIN);
    expect(removeHopAt(CHAIN, [R(), R(), R()])).toBe(CHAIN);
    expect(removeHopAt(CHAIN, [O()])).toBe(CHAIN);
  });

  it("folds an OR group left with one hop into related, in front", () => {
    const q: CardQuery = {
      type: "Organization",
      related: [{ relation: "relOrgToObj", type: "Objective" }],
      related_any: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToBC", type: "BusinessCapability", negate: true },
      ],
    };
    expect(removeHopAt(q, [O(1)])).toEqual({
      type: "Organization",
      related: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToObj", type: "Objective" },
      ],
    });
    expect(removeHopAt(OR_QUERY, [O(0)])).toEqual({
      type: "Organization",
      related: [{ relation: "relOrgToBC", type: "BusinessCapability" }],
    });
    const three: CardQuery = {
      ...OR_QUERY,
      related_any: [...OR_QUERY.related_any!, { relation: "relOrgToObj", type: "Objective" }],
    };
    expect(removeHopAt(three, [O(1)])).toEqual({
      type: "Organization",
      related_any: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToObj", type: "Objective" },
      ],
    });
  });

  it("flips has / has no on a hop, never on the start", () => {
    const on = toggleNegate(CHAIN, P1);
    expect(on.related![0]).toEqual({
      relation: "relOrgToApp",
      type: "Application",
      where: { lifecycle_phase: ["active"] },
      negate: true,
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    });
    expect(toggleNegate(CHAIN, P2).related![0].related).toEqual([
      { relation: "relInitiativeToApp", type: "Initiative" },
    ]);
    expect(toggleNegate(OR_QUERY, [O(1)]).related_any![1]).toEqual({
      relation: "relOrgToBC",
      type: "BusinessCapability",
      negate: true,
    });
    expect(toggleNegate(CHAIN, [])).toBe(CHAIN);
    expect(toggleNegate(CHAIN, [R(7)])).toBe(CHAIN);
  });
});

describe("addBranch", () => {
  it("appends an AND branch to the node's related list", () => {
    expect(addBranch(BRANCHED, [], "and", "relOrgToObj", "Objective")).toEqual({
      type: "Organization",
      related: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToBC", type: "BusinessCapability", negate: true },
        { relation: "relOrgToObj", type: "Objective" },
      ],
    });
  });

  it("moves the continuation hop into related_any with the first OR branch", () => {
    expect(addBranch(CHAIN, [], "or", "relOrgToBC", "BusinessCapability")).toEqual({
      type: "Organization",
      where: { approval_status: ["APPROVED"] },
      related_any: [
        {
          relation: "relOrgToApp",
          type: "Application",
          where: { lifecycle_phase: ["active"] },
          related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
        },
        { relation: "relOrgToBC", type: "BusinessCapability" },
      ],
    });
    // The AND hops after the continuation stay in related.
    expect(addBranch(BRANCHED, [], "or", "relOrgToObj", "Objective")).toEqual({
      type: "Organization",
      related: [{ relation: "relOrgToBC", type: "BusinessCapability", negate: true }],
      related_any: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToObj", type: "Objective" },
      ],
    });
  });

  it("joins a later OR branch to related_any", () => {
    expect(addBranch(OR_QUERY, [], "or", "relOrgToObj", "Objective")).toEqual({
      type: "Organization",
      related_any: [
        { relation: "relOrgToApp", type: "Application" },
        { relation: "relOrgToBC", type: "BusinessCapability" },
        { relation: "relOrgToObj", type: "Objective" },
      ],
    });
  });

  it("takes no branch under a node with no hop; its first hop is appendHopAt's", () => {
    expect(addBranch(CHAIN, P2, "or", "r", "X")).toBe(CHAIN);
    expect(addBranch(CHAIN, P2, "and", "r", "X")).toBe(CHAIN);
    const expected: CardQuery = {
      ...CHAIN,
      related: [
        {
          ...CHAIN.related![0],
          related: [
            {
              relation: "relInitiativeToApp",
              type: "Initiative",
              negate: true,
              related: [{ relation: "r", type: "X" }],
            },
          ],
        },
      ],
    };
    expect(appendHopAt(CHAIN, P2, "r", "X")).toEqual(expected);
  });

  it("branches under a hop inside an OR group", () => {
    const withHop = appendHopAt(OR_QUERY, [O(1)], "relBcToApp", "Application");
    expect(addBranch(withHop, [O(1)], "and", "relBcToObj", "Objective").related_any![1]).toEqual({
      relation: "relOrgToBC",
      type: "BusinessCapability",
      related: [
        { relation: "relBcToApp", type: "Application" },
        { relation: "relBcToObj", type: "Objective" },
      ],
    });
  });

  it("changes nothing where it cannot branch", () => {
    expect(addBranch(CHAIN, [R(3)], "and", "r", "X")).toBe(CHAIN);
    expect(addBranch(CHAIN, [R(3)], "or", "r", "X")).toBe(CHAIN);
    const full: CardQuery = { type: "A", related_any: hops(MAX_HOPS_PER_LIST) };
    expect(addBranch(full, [], "or", "r", "X")).toBe(full);
  });
});

/** `n` plain hops `h0`, `h1`, … to cards of type B. */
function hops(n: number): CardQueryHop[] {
  return Array.from({ length: n }, (_, i) => ({ relation: `h${i}`, type: "B" }));
}

describe("canBranch", () => {
  it("allows a branch under a typed node within every cap", () => {
    expect(canBranch(CHAIN, [])).toBe(true);
    expect(canBranch(CHAIN, P1)).toBe(true);
    expect(canBranch(CHAIN, [], "and")).toBe(true);
    expect(canBranch(CHAIN, [], "or")).toBe(true);
  });

  it("is false under a node with no hop yet, whichever connective: nothing to combine with", () => {
    expect(canBranch(CHAIN, P2)).toBe(false);
    expect(canBranch(CHAIN, P2, "and")).toBe(false);
    expect(canBranch(CHAIN, P2, "or")).toBe(false);
    expect(canBranch({ type: "A" }, [])).toBe(false);
    // The `+ relation` chip still takes the first hop there.
    expect(canAppend(CHAIN, P2)).toBe(true);
    expect(canAppend({ type: "A" }, [])).toBe(true);
  });

  it("is false without a type or a node", () => {
    expect(canBranch({ type: "" }, [])).toBe(false);
    expect(canBranch(CHAIN, [R(5)])).toBe(false);
  });

  it("is false at depth 3", () => {
    const three = appendHopAt(CHAIN, P2, "relX", "Objective");
    expect(canBranch(three, [R(), R(), R()])).toBe(false);
    expect(canBranch(three, P2)).toBe(true);
  });

  it("is false for a list holding 10 hops, the other list still open", () => {
    expect(MAX_HOPS_PER_LIST).toBe(10);
    const and10: CardQuery = { type: "A", related: hops(10) };
    expect(canBranch(and10, [], "and")).toBe(false);
    expect(canBranch(and10, [], "or")).toBe(true);
    expect(canBranch(and10, [])).toBe(true);
    const or10: CardQuery = { type: "A", related_any: hops(10) };
    expect(canBranch(or10, [], "or")).toBe(false);
    expect(canBranch(or10, [], "and")).toBe(true);
    expect(canBranch({ type: "A", related: hops(9) }, [], "and")).toBe(true);
    expect(canBranch({ type: "A", related_any: hops(9) }, [], "or")).toBe(true);
  });

  it("is false with 12 hops in the tree, both lists counted", () => {
    expect(MAX_HOPS_TOTAL).toBe(12);
    const twelve: CardQuery = {
      type: "A",
      related: [{ relation: "x", type: "B", related: hops(5) }, ...hops(1)],
      related_any: hops(5),
    };
    expect(canBranch(twelve, [])).toBe(false);
    expect(canBranch(twelve, [R(0)])).toBe(false);
    const eleven: CardQuery = { ...twelve, related_any: hops(4) };
    expect(canBranch(eleven, [])).toBe(true);
    expect(canBranch(eleven, [R(0)], "and")).toBe(true);
  });
});

describe("canAppend", () => {
  it("allows a hop on a typed node within the depth, tree and related caps", () => {
    expect(canAppend({ type: "" }, [])).toBe(false);
    expect(canAppend(CHAIN, [R(5)])).toBe(false);
    const three = appendHopAt(CHAIN, P2, "relX", "Objective");
    expect(canAppend(three, [R(), R(), R()])).toBe(false);
    expect(canAppend({ type: "A", related: hops(10) }, [])).toBe(false);
    expect(canAppend({ type: "A", related: hops(9) }, [])).toBe(true);
    // A full OR group does not stop the AND list.
    expect(canAppend({ type: "A", related_any: hops(10) }, [])).toBe(true);
    const twelve: CardQuery = { type: "A", related: hops(6), related_any: hops(6) };
    expect(canAppend(twelve, [])).toBe(false);
    expect(canAppend({ ...twelve, related_any: hops(5) }, [])).toBe(true);
  });
});

describe("hopCount", () => {
  it("counts the hops right under a node, both lists, not deeper ones", () => {
    expect(hopCount(undefined)).toBe(0);
    expect(hopCount({ type: "A" })).toBe(0);
    expect(hopCount(CHAIN)).toBe(1);
    expect(hopCount({ type: "A", related: hops(2), related_any: hops(3) })).toBe(5);
  });
});

describe("normalizeHops", () => {
  const a: CardQueryHop = { relation: "a", type: "A" };
  const b: CardQueryHop = { relation: "b", type: "B" };
  const c: CardQueryHop = { relation: "c", type: "C" };

  it("folds an OR group of one into related, in front", () => {
    expect(normalizeHops({ type: "X", related: [b, c], related_any: [a] })).toEqual({
      type: "X",
      related: [a, b, c],
    });
    expect(normalizeHops({ type: "X", related_any: [a] })).toEqual({ type: "X", related: [a] });
  });

  it("leaves a node without a one-hop OR group as it is", () => {
    const two: CardQuery = { type: "X", related: [c], related_any: [a, b] };
    expect(normalizeHops(two)).toBe(two);
    const none: CardQuery = { type: "X", related: [a] };
    expect(normalizeHops(none)).toBe(none);
  });

  it("is the one rule: removing an OR hop and sending a one-hop OR group give the same query", () => {
    const query: CardQuery = { type: "X", related: [c], related_any: [a, b] };
    const removed = removeHopAt(query, [O(1)]);
    const sent = sendableQuery({ ...query, related_any: [a, { relation: "b", type: "" }] });
    const folded = { type: "X", related: [a, c] };
    expect(removed).toEqual(folded);
    expect(sent).toEqual(folded);
    expect(removed).toEqual(sent);
  });
});

describe("setCondition / removeCondition / conditionValues", () => {
  it("sets each kind of condition on the node it names", () => {
    const q = { type: "Application" };
    expect(setCondition(q, [], "lifecycle_phase", ["active"])).toEqual({
      type: "Application",
      where: { lifecycle_phase: ["active"] },
    });
    expect(setCondition(q, [], "subtype", ["bizApp"]).where).toEqual({ subtype: ["bizApp"] });
    expect(setCondition(q, [], "approval_status", ["DRAFT"]).where).toEqual({
      approval_status: ["DRAFT"],
    });
    expect(setCondition(q, [], "data_quality_band", ["partial", "minimal"])).toEqual({
      type: "Application",
      where: { data_quality_band: ["partial", "minimal"] },
    });
    expect(setCondition(q, [], "tags", ["t1"]).where).toEqual({ tags: ["t1"] });
    expect(setCondition(q, [], { attribute: "criticality" }, ["high"]).where).toEqual({
      attributes: { criticality: ["high"] },
    });
    expect(setCondition(CHAIN, P2, "subtype", ["proj"]).related![0].related![0]).toEqual({
      relation: "relInitiativeToApp",
      type: "Initiative",
      negate: true,
      where: { subtype: ["proj"] },
    });
  });

  it("keeps an empty list as a condition still being filled in", () => {
    expect(setCondition({ type: "A" }, [], "lifecycle_phase", [])).toEqual({
      type: "A",
      where: { lifecycle_phase: [] },
    });
  });

  it("does not share the caller's array", () => {
    const values = ["active"];
    const q = setCondition({ type: "A" }, [], "lifecycle_phase", values);
    values.push("plan");
    expect(q.where).toEqual({ lifecycle_phase: ["active"] });
  });

  it("removes a condition and drops an emptied attributes map and where", () => {
    const q: CardQuery = {
      type: "A",
      where: { lifecycle_phase: ["active"], attributes: { a: ["x"], b: ["y"] } },
    };
    expect(removeCondition(q, [], { attribute: "a" })).toEqual({
      type: "A",
      where: { lifecycle_phase: ["active"], attributes: { b: ["y"] } },
    });
    const noAttrs = removeCondition(removeCondition(q, [], { attribute: "a" }), [], {
      attribute: "b",
    });
    expect(noAttrs).toEqual({ type: "A", where: { lifecycle_phase: ["active"] } });
    expect(removeCondition(noAttrs, [], "lifecycle_phase")).toEqual({ type: "A" });
    expect(removeCondition(CHAIN, P1, "lifecycle_phase").related![0]).toEqual({
      relation: "relOrgToApp",
      type: "Application",
      related: [{ relation: "relInitiativeToApp", type: "Initiative", negate: true }],
    });
  });

  it("ignores a node that is not in the tree", () => {
    expect(setCondition(CHAIN, [R(5)], "subtype", ["x"])).toBe(CHAIN);
    expect(setCondition(CHAIN, [O()], "subtype", ["x"])).toBe(CHAIN);
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
    expect(draftProblem({ type: "A", where: { cards: [] } })).toBe("empty_values");
    expect(
      draftProblem({ type: "A", related: [{ relation: "r", type: "B", where: { cards: [] } }] }),
    ).toBe("empty_values");
    expect(draftProblem({ type: "A", where: { cards: ["c1"] } })).toBeNull();
    expect(draftProblem({ type: "A", where: { attributes: { f: [] } } })).toBe("empty_values");
    expect(
      draftProblem({
        type: "A",
        related: [{ relation: "r", type: "B", related: [{ relation: "s", type: "C", where: { approval_status: [] } }] }],
      }),
    ).toBe("empty_values");
    expect(draftProblem({ type: "A", where: { data_quality_band: [] } })).toBe("empty_values");
    expect(draftProblem({ type: "A", where: { data_quality_band: ["complete"] } })).toBeNull();
    expect(draftProblem({ type: "A", related: [{ relation: "r", type: "" }] })).toBe("empty_type");
    expect(draftProblem(CHAIN)).toBeNull();
    expect(draftProblem(BRANCHED)).toBeNull();
    expect(draftProblem(OR_QUERY)).toBeNull();
  });

  it("names a branch without a type, in either list and below one, before an empty condition", () => {
    expect(
      draftProblem({
        type: "A",
        where: { subtype: [] },
        related_any: [
          { relation: "r", type: "B" },
          { relation: "s", type: "" },
        ],
      }),
    ).toBe("empty_type");
    expect(
      draftProblem({
        type: "A",
        related: [
          { relation: "r", type: "B" },
          { relation: "s", type: "C", related: [{ relation: "t", type: "" }] },
        ],
      }),
    ).toBe("empty_type");
    expect(
      draftProblem({
        type: "A",
        related_any: [
          { relation: "r", type: "B", where: { tags: [] } },
          { relation: "s", type: "C" },
        ],
      }),
    ).toBe("empty_values");
  });
});

describe("sendableQuery", () => {
  it("leaves out the empty condition lists on the start node, keeping the rest", () => {
    const query: CardQuery = {
      type: "A",
      where: {
        lifecycle_phase: [],
        subtype: ["s1"],
        approval_status: [],
        tags: [],
        attributes: { f: [], g: ["x"] },
      },
    };
    expect(sendableQuery(query)).toEqual({
      type: "A",
      where: { subtype: ["s1"], attributes: { g: ["x"] } },
    });
  });

  it("keeps a filled data quality band condition and drops an empty one", () => {
    expect(
      sendableQuery({ type: "A", where: { data_quality_band: ["partial"], lifecycle_phase: [] } }),
    ).toEqual({ type: "A", where: { data_quality_band: ["partial"] } });
    expect(
      sendableQuery({
        type: "A",
        related: [{ relation: "r", type: "B", where: { data_quality_band: [] } }],
      }),
    ).toEqual({ type: "A", related: [{ relation: "r", type: "B" }] });
  });

  it("drops a where and an attributes map left with nothing", () => {
    expect(
      sendableQuery({ type: "A", where: { lifecycle_phase: [], attributes: { f: [] } } }),
    ).toEqual({ type: "A" });
  });

  it("drops include_descendants with an emptied cards condition at a hop", () => {
    const query: CardQuery = {
      type: "A",
      related: [
        {
          relation: "r",
          type: "B",
          negate: true,
          where: { cards: [], include_descendants: true, lifecycle_phase: ["active"] },
          related: [{ relation: "s", type: "C", where: { tags: [] } }],
        },
      ],
    };
    expect(sendableQuery(query)).toEqual({
      type: "A",
      related: [
        {
          relation: "r",
          type: "B",
          negate: true,
          where: { lifecycle_phase: ["active"] },
          related: [{ relation: "s", type: "C" }],
        },
      ],
    });
  });

  it("keeps include_descendants with picked cards", () => {
    expect(
      sendableQuery({ type: "A", where: { cards: ["c1"], include_descendants: true } }),
    ).toEqual({ type: "A", where: { cards: ["c1"], include_descendants: true } });
  });

  it("returns an equal copy of a query with nothing empty, branches included", () => {
    expect(sendableQuery(CHAIN)).toEqual(CHAIN);
    expect(sendableQuery(CHAIN)).not.toBe(CHAIN);
    expect(sendableQuery(BRANCHED)).toEqual(BRANCHED);
  });

  it("keeps the branches beside the chain, emptied lists removed there too", () => {
    const query: CardQuery = {
      type: "A",
      related: [
        { relation: "r", type: "B", where: { subtype: ["x"] } },
        { relation: "q", type: "D", where: { subtype: [] } },
      ],
    };
    expect(sendableQuery(query)).toEqual({
      type: "A",
      related: [
        { relation: "r", type: "B", where: { subtype: ["x"] } },
        { relation: "q", type: "D" },
      ],
    });
  });

  it("drops a branch without a type, in either list", () => {
    expect(
      sendableQuery({
        type: "A",
        related: [
          { relation: "r", type: "B", related: [{ relation: "t", type: "" }] },
          { relation: "s", type: "" },
        ],
        related_any: [
          { relation: "u", type: "C" },
          { relation: "v", type: "D" },
          { relation: "w", type: "" },
        ],
      }),
    ).toEqual({
      type: "A",
      related: [{ relation: "r", type: "B", related: [] }],
      related_any: [
        { relation: "u", type: "C" },
        { relation: "v", type: "D" },
      ],
    });
  });

  it("sends an OR group of one hop as a plain hop in front of related", () => {
    expect(
      sendableQuery({
        type: "A",
        related: [{ relation: "r", type: "B" }],
        related_any: [
          { relation: "s", type: "C", where: { subtype: [] }, negate: true },
          { relation: "t", type: "" },
        ],
      }),
    ).toEqual({
      type: "A",
      related: [
        { relation: "s", type: "C", negate: true },
        { relation: "r", type: "B" },
      ],
    });
    expect(sendableQuery({ type: "A", related_any: [{ relation: "s", type: "C" }] })).toEqual({
      type: "A",
      related: [{ relation: "s", type: "C" }],
    });
    expect(sendableQuery({ type: "A", related_any: [] })).toEqual({ type: "A" });
    expect(sendableQuery(OR_QUERY)).toEqual(OR_QUERY);
  });

  it("is null without a start type", () => {
    expect(sendableQuery({ type: "" })).toBeNull();
    expect(sendableQuery({ type: "", where: { subtype: ["x"] } })).toBeNull();
  });

  it("does not mutate the query or share its lists", () => {
    const query: CardQuery = {
      type: "A",
      where: { subtype: ["s1"], cards: [], include_descendants: true, attributes: { f: [] } },
      related: [{ relation: "r", type: "B", where: { tags: [] } }],
    };
    const before = structuredClone(query);
    const sent = sendableQuery(query)!;
    expect(query).toEqual(before);
    sent.where!.subtype!.push("s2");
    expect(query.where!.subtype).toEqual(["s1"]);
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

describe("cards condition", () => {
  it("sets picked cards on a node and reads them back", () => {
    const q = setCondition(CHAIN, P1, "cards", ["a1", "a2"]);
    expect(q.related![0].where).toEqual({ lifecycle_phase: ["active"], cards: ["a1", "a2"] });
    expect(conditionValues(q.related![0].where, "cards")).toEqual(["a1", "a2"]);
    expect(q.where).toEqual(CHAIN.where);
  });

  it("reads and removes a data quality band condition, keeping the others", () => {
    const q: CardQuery = {
      type: "Application",
      where: { data_quality_band: ["complete"], approval_status: ["APPROVED"] },
    };
    expect(conditionValues(q.where, "data_quality_band")).toEqual(["complete"]);
    expect(removeCondition(q, [], "data_quality_band")).toEqual({
      type: "Application",
      where: { approval_status: ["APPROVED"] },
    });
    const alone: CardQuery = { type: "Application", where: { data_quality_band: ["minimal"] } };
    expect(removeCondition(alone, [], "data_quality_band")).toEqual({ type: "Application" });
  });

  it("drops Include sub-cards with the cards it qualifies", () => {
    const q: CardQuery = {
      type: "Organization",
      where: { approval_status: ["APPROVED"], cards: ["o1"], include_descendants: true },
    };
    expect(removeCondition(q, [], "cards").where).toEqual({ approval_status: ["APPROVED"] });
    const alone: CardQuery = { type: "Organization", where: { cards: ["o1"], include_descendants: true } };
    expect(removeCondition(alone, [], "cards")).toEqual({ type: "Organization" });
    // Another condition's removal leaves the flag alone.
    expect(removeCondition(q, [], "approval_status").where).toEqual({
      cards: ["o1"],
      include_descendants: true,
    });
  });

  it("turns Include sub-cards on and off, only where cards are picked", () => {
    const picked = setCondition(CHAIN, P1, "cards", ["a1"]);
    const on = setIncludeDescendants(picked, P1, true);
    expect(on.related![0].where).toEqual({
      lifecycle_phase: ["active"],
      cards: ["a1"],
      include_descendants: true,
    });
    expect(on.related![0].related).toEqual(CHAIN.related![0].related);
    const off = setIncludeDescendants(on, P1, false);
    expect(off.related![0].where).toEqual({ lifecycle_phase: ["active"], cards: ["a1"] });
    expect(off).toEqual(picked);
    // No picked cards on the node (or no such node): nothing changes.
    expect(setIncludeDescendants(CHAIN, P1, true)).toBe(CHAIN);
    expect(setIncludeDescendants(CHAIN, [], true)).toBe(CHAIN);
    expect(setIncludeDescendants(picked, [R(5)], true)).toBe(picked);
  });

  it("collects the picked ids of every node, branches included, deduped in order", () => {
    const q: CardQuery = {
      type: "Organization",
      where: { cards: ["o1", "o2"] },
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          where: { cards: ["a1", "o2"] },
          related: [{ relation: "relInitiativeToApp", type: "Initiative", where: { cards: ["i1"] } }],
        },
        { relation: "relOrgToBC", type: "BusinessCapability", where: { cards: ["b1", "a1"] } },
      ],
    };
    expect(pickedCardIds(q)).toEqual(["o1", "o2", "a1", "i1", "b1"]);
    const or: CardQuery = {
      type: "Organization",
      related: [{ relation: "relOrgToObj", type: "Objective", where: { cards: ["j1"] } }],
      related_any: [
        {
          relation: "relOrgToApp",
          type: "Application",
          where: { cards: ["a1"] },
          related_any: [
            { relation: "x", type: "X", where: { cards: ["x1"] } },
            { relation: "y", type: "Y", where: { cards: ["y1", "j1"] } },
          ],
        },
        { relation: "relOrgToBC", type: "BusinessCapability", where: { cards: ["b1"] } },
      ],
    };
    expect(pickedCardIds(or)).toEqual(["j1", "a1", "x1", "y1", "b1"]);
    expect(pickedCardIds(CHAIN)).toEqual([]);
    expect(pickedCardIds({ type: "" })).toEqual([]);
  });

  it("names one picked card: id while loading, hidden / unknown label, else its name", () => {
    const labels = { hiddenCard: "(hidden card)", unknownCard: "(unknown card)" };
    expect(cardNameLabel(undefined, "id-1", labels)).toBe("id-1");
    expect(cardNameLabel({ kind: "hidden" }, "id-2", labels)).toBe("(hidden card)");
    expect(cardNameLabel({ kind: "unknown" }, "id-3", labels)).toBe("(unknown card)");
    expect(cardNameLabel({ kind: "card", name: "Alpha", type: "Application" }, "id-4", labels)).toBe(
      "Alpha",
    );
  });

  it("labels the chip with up to three names, +N, and the sub-cards suffix", () => {
    const labels = {
      cardsLabel: "Cards",
      hiddenCard: "(hidden card)",
      unknownCard: "(unknown card)",
      subCards: "sub-cards",
    };
    const names = new Map<string, CardNameEntry>([
      ["a", { kind: "card", name: "Alpha", type: "Application" }],
      ["b", { kind: "card", name: "Beta", type: "Application" }],
      ["h", { kind: "hidden" }],
      ["u", { kind: "unknown" }],
    ]);
    expect(cardsChipLabel([], names, false, labels)).toBe("Cards");
    expect(cardsChipLabel([], names, true, labels)).toBe("Cards · sub-cards");
    expect(cardsChipLabel(["a", "b", "h"], names, false, labels)).toBe(
      "Cards: Alpha, Beta, (hidden card)",
    );
    expect(cardsChipLabel(["a", "b", "u", "loading"], names, true, labels)).toBe(
      "Cards: Alpha, Beta, (unknown card) +1 · sub-cards",
    );
    expect(cardsChipLabel(["loading", "a"], names, false, labels)).toBe("Cards: loading, Alpha");
    expect(cardsChipLabel(["a", "b", "h"], names, false, labels, 2)).toBe("Cards: Alpha, Beta +1");
  });
});
